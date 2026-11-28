from django.db.models import Exists, F, OuterRef, Q, Subquery
from django.db.models.functions import Lower
from rest_framework.exceptions import ValidationError

from .models import AssetCustody, DeviceAssignment, LocationObservation


ASSET_STATUSES = {'ACTIVE': 'Active', 'MAINTENANCE': 'Maintenance', 'INACTIVE': 'Inactive'}
EVIDENCE = {
    'VALID': 'CURRENT', 'CURRENT': 'CURRENT', 'CONFIRMED': 'CONFIRMED',
    'TRANSITIONING': 'TRANSITIONING', 'AMBIGUOUS': 'AMBIGUOUS',
    'EXPIRED': 'LAST_KNOWN', 'LAST_KNOWN': 'LAST_KNOWN', 'ESTIMATED': 'ESTIMATED',
}


def current_custody():
    return AssetCustody.objects.filter(
        asset_id=OuterRef('pk'), ended_at__isnull=True, site_id=OuterRef('site_id'),
        personnel__site_id=OuterRef('site_id'), personnel__organisation_id=OuterRef('organisation_id'),
    )


def asset_projection(records):
    custody = current_custody()
    assignment = DeviceAssignment.objects.filter(
        asset_id=OuterRef('pk'), ended_at__isnull=True, site_id=OuterRef('site_id'),
        node_id=OuterRef('assigned_node_id'), node__site_id=OuterRef('site_id'),
        node__organisation_id=OuterRef('organisation_id'),
    )
    records = records.select_related('assigned_node').annotate(
        custodian_id=Subquery(custody.values('personnel_id')[:1]),
        custodian_name=Subquery(custody.values('personnel__display_name')[:1]),
        custodian_identifier=Subquery(custody.values('personnel__identifier')[:1]),
        custody_started_at=Subquery(custody.values('started_at')[:1]),
        tracker_assignment_id=Subquery(assignment.values('pk')[:1]),
        tracker_started_at=Subquery(assignment.values('started_at')[:1]),
    )
    # A receipt timestamp or assignment-at-receipt cannot locate reused equipment.
    observation = LocationObservation.objects.filter(
        node_id=OuterRef('assigned_node_id'), site_id=OuterRef('site_id'),
        event__node_id=OuterRef('assigned_node_id'), event__site_id=OuterRef('site_id'),
        captured_at__gte=OuterRef('tracker_started_at'), captured_at__lte=F('received_at'),
        simulated=False, zone__site_id=OuterRef('site_id'), quality__in=EVIDENCE,
    ).filter(
        Q(event__capture_assignment_id__isnull=True)
        | Q(event__capture_assignment_id=OuterRef('tracker_assignment_id')),
    ).order_by('-captured_at', '-pk')
    return records.annotate(
        asset_zone=Subquery(observation.values('zone__code')[:1]),
        asset_observed_at=Subquery(observation.values('captured_at')[:1]),
        asset_observation_quality=Subquery(observation.values('quality')[:1]),
    )


def registry_page(records, params):
    archive = params.get('archive', 'current')
    filters = {'archive': (archive, {'current', 'archived', 'all'}),
               'custody': (params.get('custody', ''), {'', 'issued', 'unissued'}),
               'tracker': (params.get('tracker', ''), {'', 'assigned', 'unassigned'}),
               'direction': (params.get('direction', 'asc'), {'asc', 'desc'})}
    order_fields = {'name': 'name', 'asset_type': 'asset_type', 'operational_status': 'operational_status'}
    sort = params.get('sort', 'name')
    for key, (value, choices) in filters.items():
        if value not in choices:
            raise ValidationError({key: 'Select a supported filter value.'})
    if sort not in order_fields:
        raise ValidationError({'sort': 'Select a supported sort field.'})
    if archive != 'all':
        records = records.filter(archived=archive == 'archived')
    if params.get('classification'):
        records = records.filter(asset_type__iexact=params['classification'])
    if params.get('status'):
        records = records.filter(operational_status=params['status'])
    if filters['custody'][0]:
        custody = Exists(current_custody())
        records = records.filter(custody if filters['custody'][0] == 'issued' else ~custody)
    if filters['tracker'][0]:
        tracker = Q(assigned_node__site_id=F('site_id'), assigned_node__organisation_id=F('organisation_id'))
        records = records.filter(tracker if filters['tracker'][0] == 'assigned' else ~tracker)
    try:
        page_size = int(params.get('page_size', 25))
        page = int(params.get('page', 1))
    except (ValueError, OverflowError):
        page, page_size = 1, 25
    if page_size not in {25, 50, 100}:
        page_size = 25
    count = records.count()
    page = min(max(page, 1), max(1, (count + page_size - 1) // page_size))
    field = Lower(order_fields[sort])
    ordering = field.desc() if filters['direction'][0] == 'desc' else field.asc()
    start = (page - 1) * page_size
    return records.order_by(ordering, 'pk')[start:start + page_size], {
        'count': count, 'page': page, 'page_size': page_size,
    }


def site_asset_options(records):
    return {
        'site_total': records.filter(archived=False).count(),
        'classifications': list(records.exclude(asset_type='').order_by('asset_type').values_list('asset_type', flat=True).distinct()),
        'statuses': list(dict.fromkeys([
            *ASSET_STATUSES,
            *records.exclude(operational_status='').order_by('operational_status').values_list('operational_status', flat=True).distinct(),
        ])),
    }
