from django.db.models import Prefetch

from .models import DeviceAssignment, LocationEvidence, OperationalRole, Personnel


def personnel_options():
    return {
        'operational_roles': [{'value': code, 'label': label} for code, label in OperationalRole.choices],
        'employment_statuses': [{'value': code, 'label': label} for code, label in Personnel.EMPLOYMENT_STATUSES],
    }


def personnel_with_wearables(records):
    return records.select_related('assigned_node').prefetch_related(Prefetch(
        'device_assignments',
        queryset=DeviceAssignment.objects.filter(ended_at__isnull=True).only(
            'personnel_id', 'site_id', 'node_id', 'started_at',
        ),
        to_attr='active_wearable_assignments',
    ))


def wearable_location(person):
    node = person.assigned_node
    if not node or node.site_id != person.site_id or node.is_simulated:
        return None
    assignments = getattr(person, 'active_wearable_assignments', None)
    if assignments is None:
        assignments = person.device_assignments.filter(ended_at__isnull=True)
    if (not node.location_observed_at or not node.current_zone or node.current_zone == 'UNASSIGNED'
            or node.location_evidence == LocationEvidence.UNKNOWN):
        return None
    for assignment in assignments:
        if (assignment.site_id == person.site_id and assignment.node_id == node.pk
                and node.location_observed_at >= assignment.started_at.timestamp() * 1000):
            return node
    return None
