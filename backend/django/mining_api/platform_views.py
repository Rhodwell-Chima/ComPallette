from django.db import transaction
from django.db.models import Case, F, Q, When
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from .access import enforce, permitted_sites, operator_capabilities
from .operations import ENTITIES, mutate, relationships, preview_transfer
from .models import Site, SiteTransfer, DeviceAssignment, AssetCustody, AuditEntry, Node, NodeRole, Personnel, SafetyAlert
from .assets import asset_projection
from .personnel import personnel_options, personnel_with_wearables
from .serializers import NodeSerializer, PersonnelSerializer, AssetSerializer, SafetyAlertSerializer, AuditEntrySerializer, MeasurementReadingSerializer


SERIALIZERS = {'personnel': PersonnelSerializer, 'assets': AssetSerializer, 'devices': NodeSerializer}


def asset_relationships(records, user_sites, audit_sites, *, custody=False):
    records = records.annotate(started_actor=F('started_by__username'), ended_actor=F('ended_by__username'))
    if custody:
        records = records.annotate(person_site=F('personnel__site_id'), person_name=F('personnel__display_name'),
                                   person_identifier=F('personnel__identifier'))
    rows = list(records.values()[:100])
    for row in rows:
        if row['site_id'] not in audit_sites:
            for key in ('started_actor', 'ended_actor', 'started_by_id', 'ended_by_id'):
                row.pop(key, None)
        if custody and row.pop('person_site') not in user_sites:
            row.update(personnel_id=None, person_name=None, person_identifier=None)
    return rows


def asset_detail_history(entity, user, data, history, custody, assignments, sites, audit_sites):
    site_ids = {site.pk for site in sites}
    data.update(
        current_assignments=asset_relationships(assignments.filter(site_id__in=site_ids).order_by('pk'), site_ids, audit_sites),
        current_custody=asset_relationships(custody.filter(site_id__in=site_ids).order_by('pk'), site_ids, audit_sites, custody=True),
        assignment_history=asset_relationships(history, site_ids, audit_sites),
        custody_history=asset_relationships(entity.custody_history.filter(site_id__in=site_ids).order_by('-started_at', '-pk'),
                                           site_ids, audit_sites, custody=True),
        transfer_destinations=[{'id': site.pk, 'name': site.name} for site in sites
                               if site.pk != entity.site_id and site.organisation_id == entity.organisation_id
                               and 'manage_assets' in operator_capabilities(user, site)],
    )
    transfers = SiteTransfer.objects.filter(entity_type='assets', entity_id=str(entity.pk),
                                            source_id__in=site_ids, destination_id__in=site_ids)
    data['transfer_history'] = list(transfers.order_by('-created_at', '-pk').annotate(
        source_name=F('source__name'), destination_name=F('destination__name'), actor_name=F('actor__username'),
    ).values('id', 'source', 'destination', 'source_name', 'destination_name', 'created_at', 'reason', 'actor_name')[:25])
    for row in data['transfer_history']:
        if {row['source'], row['destination']} - audit_sites:
            row.pop('actor_name')


def entity_data(entity, kind, user):
    data = dict(SERIALIZERS[kind](entity).data)
    data.update(version=entity.version, archived=entity.archived,
                capabilities=operator_capabilities(user, entity.site))
    assignments, custody = relationships(entity)
    if kind == 'personnel':
        data['user_id'] = entity.user_id
        data.update(personnel_options())
    owner_key = 'node' if kind == 'devices' else 'personnel' if kind == 'personnel' else 'asset'
    allowed_sites = permitted_sites(user).select_related('organisation')
    sites = list(allowed_sites)
    audit_sites = {site.pk for site in sites if 'view_audit' in operator_capabilities(user, site)}
    history = DeviceAssignment.objects.filter(**{owner_key: entity}, site__in=allowed_sites).order_by('-started_at', '-pk')
    if kind == 'assets':
        asset_detail_history(entity, user, data, history, custody, assignments, sites, audit_sites)
    else:
        data['current_assignments'] = list(assignments.values())
        data['current_custody'] = list(custody.values())
        data['assignment_history'] = list(history.values()[:100])
        data['custody_history'] = [] if kind == 'devices' else list(AssetCustody.objects.filter(
            **{owner_key: entity}, site__in=allowed_sites,
        ).order_by('-started_at', '-pk').annotate(
            asset_identifier=Case(When(asset__site__in=allowed_sites, then=F('asset__identifier'))),
            asset_name=Case(When(asset__site__in=allowed_sites, then=F('asset__name'))),
        ).values()[:100])
    node = entity if kind == 'devices' else entity.assigned_node
    if kind == 'assets' and node and (node.site_id != entity.site_id or node.organisation_id != entity.organisation_id):
        node = None
    observation_sites = [entity.site_id] if kind in ('personnel', 'assets') else allowed_sites
    data['location_observations'] = list(node.location_observations.filter(site__in=observation_sites).order_by('-received_at').values()[:25]) if node else []
    data['measurements'] = MeasurementReadingSerializer(node.measurements.filter(site=entity.site).order_by('-received_at')[:25], many=True).data if node else []
    # These are explicitly device incidents, not inferred historical personal exposure.
    data['device_alerts'] = SafetyAlertSerializer(SafetyAlert.objects.filter(node=node, site=entity.site).order_by('-created_at')[:25], many=True).data if node else []
    data['audit'] = AuditEntrySerializer(AuditEntry.objects.filter(entity_type=entity._meta.model_name, entity_id=str(entity.pk), site_id__in=audit_sites)[:50], many=True).data
    return data


class EntityDetailView(APIView):
    def get(self, request, kind, entity_id):
        if kind not in ENTITIES:
            raise ValidationError('Unknown entity type.')
        records = ENTITIES[kind].objects.all()
        if kind == 'personnel':
            records = personnel_with_wearables(records)
        if kind == 'assets':
            records = asset_projection(records)
        entity = get_object_or_404(records, pk=entity_id, site__in=permitted_sites(request.user))
        destination_id = request.query_params.get('preview_destination')
        if kind == 'assets' and (destination_id or request.query_params.get('preview_archive')):
            enforce(request.user, 'manage_assets', entity.site)
            if entity.archived:
                raise ValidationError('This asset is archived.')
            assignments, custody = relationships(entity)
            trackers = list(assignments.order_by('pk').values('id', 'node_id'))
            scoped_sites = permitted_sites(request.user)
            custodians = list(custody.order_by('pk').values('id').annotate(
                person_name=Case(When(personnel__site__in=scoped_sites, then=F('personnel__display_name'))),
                person_identifier=Case(When(personnel__site__in=scoped_sites, then=F('personnel__identifier'))),
            ))
            if destination_id:
                destination = get_object_or_404(permitted_sites(request.user), pk=destination_id)
                enforce(request.user, 'manage_assets', destination)
                preview_transfer(entity, destination)
            return Response({'version': entity.version, 'assignment_ids': [row['id'] for row in trackers],
                             'custody_ids': [row['id'] for row in custodians], 'trackers': trackers, 'custodians': custodians})
        if destination_id:
            destination = get_object_or_404(permitted_sites(request.user), pk=destination_id)
            enforce(request.user, 'manage_devices' if kind == 'devices' else 'manage_assets', destination)
            return Response(preview_transfer(entity, destination))
        return Response(entity_data(entity, kind, request.user))

    def post(self, request, kind, entity_id):
        return Response(mutate(request.user, kind, entity_id, request.data))


class EligibleDevicesView(APIView):
    def get(self, request):
        site = get_object_or_404(permitted_sites(request.user), pk=request.query_params.get('site_id') or request.query_params.get('site'))
        enforce(request.user, 'manage_assets', site)
        nodes = Node.objects.filter(site=site, organisation_id=site.organisation_id, archived=False, commissioned=True,
                                    role=NodeRole.WEARABLE).exclude(assignments__ended_at__isnull=True, assignments__isnull=False)
        query = request.query_params.get('q', '').strip()
        if query:
            nodes = nodes.filter(node_id__icontains=query)
        return Response({'nodes': NodeSerializer(nodes[:100], many=True).data})


class EligibleCustodiansView(APIView):
    def get(self, request):
        site = get_object_or_404(permitted_sites(request.user), pk=request.query_params.get('site_id'))
        enforce(request.user, 'manage_assets', site)
        records = Personnel.objects.filter(site=site, organisation_id=site.organisation_id, archived=False)
        query = request.query_params.get('q', '').strip()
        if query:
            records = records.filter(Q(display_name__icontains=query) | Q(identifier__icontains=query))
        return Response({'personnel': list(records.order_by('display_name', 'identifier', 'pk').values('id', 'display_name', 'identifier')[:100])})


class PresetsView(APIView):
    def get(self, request):
        return Response({'presets': [{'id': 'generic', 'label': 'General GPS-denied environment',
            'terminology': {'personnel': 'Personnel', 'zone': 'Zone'}, 'suggested_measurements': []},
            {'id': 'mining', 'label': 'Mining', 'terminology': {'personnel': 'Personnel', 'zone': 'Zone'},
             'suggested_measurements': ['co_ppm', 'temperature_c', 'humidity_pct'],
             'notice': 'Suggestions only. No thresholds, devices or location inference are enabled.'}]})
