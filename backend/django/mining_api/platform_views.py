from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from .access import enforce, permitted_sites, operator_capabilities
from .operations import ENTITIES, mutate, relationships, preview_transfer
from .models import Site, DeviceAssignment, AssetCustody, AuditEntry, Node, Personnel, Asset, SafetyAlert
from .personnel import personnel_options, personnel_with_wearables
from .serializers import NodeSerializer, PersonnelSerializer, AssetSerializer, SafetyAlertSerializer, AuditEntrySerializer, MeasurementReadingSerializer


SERIALIZERS = {'personnel': PersonnelSerializer, 'assets': AssetSerializer, 'devices': NodeSerializer}


def entity_data(entity, kind, user):
    data = dict(SERIALIZERS[kind](entity).data)
    data.update(version=entity.version, archived=entity.archived,
                capabilities=operator_capabilities(user, entity.site))
    assignments, custody = relationships(entity)
    if kind == 'personnel':
        data['user_id'] = entity.user_id
        data.update(personnel_options())
    data['current_assignments'] = list(assignments.values())
    data['current_custody'] = list(custody.values())
    owner_key = 'node' if kind == 'devices' else 'personnel' if kind == 'personnel' else 'asset'
    history = DeviceAssignment.objects.filter(**{owner_key: entity}, site__in=permitted_sites(user)).order_by('-started_at')
    data['assignment_history'] = list(history.values()[:100])
    data['custody_history'] = [] if kind == 'devices' else list(AssetCustody.objects.filter(**{owner_key: entity}, site__in=permitted_sites(user)).order_by('-started_at').values()[:100])
    node = entity if kind == 'devices' else entity.assigned_node
    observation_sites = [entity.site_id] if kind == 'personnel' else permitted_sites(user)
    data['location_observations'] = list(node.location_observations.filter(site__in=observation_sites).order_by('-received_at').values()[:25]) if node else []
    data['measurements'] = MeasurementReadingSerializer(node.measurements.filter(site=entity.site).order_by('-received_at')[:25], many=True).data if node else []
    # These are explicitly device incidents, not inferred historical personal exposure.
    data['device_alerts'] = SafetyAlertSerializer(SafetyAlert.objects.filter(node=node, site=entity.site).order_by('-created_at')[:25], many=True).data if node else []
    audit_sites = [site.pk for site in permitted_sites(user) if 'view_audit' in operator_capabilities(user, site)]
    data['audit'] = AuditEntrySerializer(AuditEntry.objects.filter(entity_type=entity._meta.model_name, entity_id=str(entity.pk), site_id__in=audit_sites)[:50], many=True).data
    return data


class EntityDetailView(APIView):
    def get(self, request, kind, entity_id):
        if kind not in ENTITIES:
            raise ValidationError('Unknown entity type.')
        records = ENTITIES[kind].objects.all()
        if kind == 'personnel':
            records = personnel_with_wearables(records)
        entity = get_object_or_404(records, pk=entity_id, site__in=permitted_sites(request.user))
        if request.query_params.get('preview_destination'):
            destination = get_object_or_404(permitted_sites(request.user), pk=request.query_params['preview_destination'])
            enforce(request.user, 'manage_devices' if kind == 'devices' else 'manage_assets', destination)
            return Response(preview_transfer(entity, destination))
        return Response(entity_data(entity, kind, request.user))

    def post(self, request, kind, entity_id):
        return Response(mutate(request.user, kind, entity_id, request.data))


class EligibleDevicesView(APIView):
    def get(self, request):
        site = get_object_or_404(permitted_sites(request.user), pk=request.query_params.get('site_id') or request.query_params.get('site'))
        enforce(request.user, 'manage_assets', site)
        nodes = Node.objects.filter(site=site, archived=False, commissioned=True, role='WEARABLE').exclude(assignments__ended_at__isnull=True, assignments__isnull=False)
        query = request.query_params.get('q', '').strip()
        if query:
            nodes = nodes.filter(node_id__icontains=query)
        return Response({'nodes': NodeSerializer(nodes[:100], many=True).data})


class PresetsView(APIView):
    def get(self, request):
        return Response({'presets': [{'id': 'generic', 'label': 'General GPS-denied environment',
            'terminology': {'personnel': 'Personnel', 'zone': 'Zone'}, 'suggested_measurements': []},
            {'id': 'mining', 'label': 'Mining', 'terminology': {'personnel': 'Personnel', 'zone': 'Zone'},
             'suggested_measurements': ['co_ppm', 'temperature_c', 'humidity_pct'],
             'notice': 'Suggestions only. No thresholds, devices or location inference are enabled.'}]})
