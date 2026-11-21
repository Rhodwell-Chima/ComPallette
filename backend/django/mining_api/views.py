import logging
import time
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.db import transaction, IntegrityError
from django.db.models import Q, Max
from django.shortcuts import get_object_or_404
from rest_framework import status, permissions
from rest_framework.views import APIView
from rest_framework.response import Response

from .models import (
    Node, NodeRole, NodeStatus, TelemetryRecord, SafetyAlert, AlertSeverity,
    AlertStatus, AuditEntry, ProvisioningRequest, ProvisioningStatus,
    Asset, DeviceCapability, FacilityLayout, Level, LocationEvidence,
    MeasurementReading, MembershipRole, Organisation, Personnel, Site,
    SiteMembership, Structure, Zone,
)
from .serializers import (
    NodeSerializer, TelemetryRecordSerializer, SafetyAlertSerializer,
    AuditEntrySerializer, ProvisioningRequestSerializer, AssetSerializer,
    DeviceCapabilitySerializer, FacilityLayoutSerializer, LevelSerializer,
    MeasurementReadingSerializer, OrganisationSerializer, PersonnelSerializer,
    SiteSerializer, StructureSerializer, ZoneSerializer,
    SiteMembershipSerializer,
)
from .wire_validation import (
    validate_envelope, validate_payload, TelemetryPayloadSerializer, AlertPayloadSerializer,
    HeartbeatPayloadSerializer, ProvisionPayloadSerializer,
)


logger = logging.getLogger(__name__)


def validation_error_response(request, error):
    """Return a safe, machine-readable rejection for a permanently invalid event."""
    response_body = {**error, "error_code": "VALIDATION_ERROR"}
    logger.warning(
        "Gateway event rejected by validation path=%s gateway=%s error=%s",
        request.path,
        request.headers.get('X-Gateway-ID', 'unknown'),
        error.get('error', 'unknown'),
    )
    return Response(response_body, status=status.HTTP_400_BAD_REQUEST)


from .access import ROLE_CAPABILITIES, operator_capabilities, permitted_sites, enforce


def has_operator_access(user):
    return user.is_active and (user.is_superuser or permitted_sites(user).exists())


def require_capability(request, capability):
    kwargs = (request.parser_context or {}).get('kwargs', {})
    site = None
    if 'alert_id' in kwargs:
        site = get_object_or_404(SafetyAlert, pk=kwargs['alert_id']).site
    elif 'zone_id' in kwargs:
        site = get_object_or_404(Zone, pk=kwargs['zone_id']).site
    elif 'structure_id' in kwargs:
        site = get_object_or_404(Structure, pk=kwargs['structure_id']).site
    elif 'site_id' in kwargs:
        site = get_object_or_404(Site, pk=kwargs['site_id'])
    else:
        site = resolve_site(request)
    enforce(request.user, capability, site)
    return None


def resolve_site(request):
    raw_site = request.query_params.get('site')
    if not raw_site and isinstance(request.data, dict):
        raw_site = request.data.get('site')
    queryset = permitted_sites(request.user)
    if raw_site:
        return get_object_or_404(queryset, pk=raw_site)
    return queryset.order_by('name').first()


def sync_node_location(node, zone, observed_at):
    """Bind legacy zone text to managed zones without inventing a position."""
    if node.site_id and zone and zone != 'UNASSIGNED':
        zone_ref = Zone.objects.filter(site=node.site, code=zone).first()
        if zone_ref:
            node.zone_ref = zone_ref
            node.location_evidence = LocationEvidence.CONFIRMED
            node.location_observed_at = observed_at
            return
    node.zone_ref = None
    node.location_evidence = LocationEvidence.UNKNOWN if zone in ('', 'UNASSIGNED') else LocationEvidence.LAST_KNOWN
    node.location_observed_at = observed_at


def record_measurements(node, seq, received_at, zone, values):
    """Persist each supported channel idempotently alongside wire telemetry."""
    for key, display_name, unit, value, warning, critical in values:
        capability, _ = DeviceCapability.objects.get_or_create(
            node=node,
            measurement_key=key,
            defaults={
                'display_name': display_name,
                'unit': unit,
                'warning_threshold': warning,
                'critical_threshold': critical,
            },
        )
        MeasurementReading.objects.get_or_create(
            node=node,
            measurement_key=key,
            source_seq=seq,
            defaults={
                'capability': capability,
                'value': value,
                'unit': unit,
                'received_at': received_at,
                'zone': zone,
            },
        )


@ensure_csrf_cookie
def csrf_token_view(request):
    return JsonResponse({"csrfToken": get_token(request)})


class OperatorSessionView(APIView):
    permission_classes = [permissions.AllowAny]

    @method_decorator(csrf_protect)
    def post(self, request):
        username = request.data.get('username', '')
        password = request.data.get('password', '')
        user = authenticate(request, username=username, password=password)
        if user is None or not user.is_active:
            return Response({"error": "Invalid username or password"}, status=status.HTTP_401_UNAUTHORIZED)
        if not has_operator_access(user):
            return Response({"error": "This account does not have operational site access."}, status=status.HTTP_403_FORBIDDEN)
        login(request, user)
        return Response({
            "authenticated": True,
            "username": user.get_username(),
            "is_staff": user.is_staff,
            "is_superuser": user.is_superuser,
            "capabilities": operator_capabilities(user, permitted_sites(user).first()),
            "site_capabilities": {str(site.pk): operator_capabilities(user, site) for site in permitted_sites(user)},
            "sites": SiteSerializer(permitted_sites(user), many=True).data,
        })

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"authenticated": False}, status=status.HTTP_401_UNAUTHORIZED)
        return Response({
            "authenticated": True,
            "username": request.user.get_username(),
            "is_staff": request.user.is_staff,
            "is_superuser": request.user.is_superuser,
            "capabilities": operator_capabilities(request.user, permitted_sites(request.user).first()),
            "site_capabilities": {str(site.pk): operator_capabilities(request.user, site) for site in permitted_sites(request.user)},
            "sites": SiteSerializer(permitted_sites(request.user), many=True).data,
        })

    @method_decorator(csrf_protect)
    def delete(self, request):
        logout(request)
        return Response({"authenticated": False})


def check_and_update_watchdog():
    """Runs a watchdog evaluation pass to flag STALE and OFFLINE nodes."""
    now_ms = int(time.time() * 1000)
    stale_limit = now_ms - (settings.STALE_THRESHOLD_SEC * 1000)
    offline_limit = now_ms - (settings.OFFLINE_THRESHOLD_SEC * 1000)

    # 1. Flag Stale Nodes
    Node.objects.filter(
        commissioned=True, archived=False, site__active=True,
        last_seen_ts__lt=stale_limit,
        last_seen_ts__gte=offline_limit,
        status=NodeStatus.ONLINE
    ).update(status=NodeStatus.STALE)

    # 2. Flag Offline Nodes and generate COMM_LOST alert
    with transaction.atomic():
        dropping = list(Node.objects.select_for_update().filter(
            commissioned=True, archived=False, site__active=True,
            last_seen_ts__gt=0, last_seen_ts__lt=offline_limit
        ).exclude(status=NodeStatus.OFFLINE))
        for n in dropping:
            n.status = NodeStatus.OFFLINE
            n.save(update_fields=['status'])
            alerts = SafetyAlert.objects.filter(node=n, site=n.site, alert_code='COMM_LOST')
            if not alerts.exclude(status=AlertStatus.RESOLVED).exists():
                # Watchdog events use a separate code-scoped sequence from firmware.
                sequence = (SafetyAlert.objects.filter(node=n, alert_code='COMM_LOST').aggregate(value=Max('seq'))['value'] or 0) + 1
                SafetyAlert.objects.create(
                    node=n, site=n.site, seq=sequence, alert_code='COMM_LOST',
                    zone=n.current_zone, severity=AlertSeverity.WARNING,
                    details=f"Device {n.node_id} communication was not confirmed before the timeout.",
                    trigger_value=0.0, status=AlertStatus.NEW, created_at=now_ms,
                )
            AuditEntry.objects.create(
                timestamp=now_ms, actor='SYSTEM_WATCHDOG', action='COMM_LOST',
                details=f"Node {n.node_id} marked OFFLINE in {n.current_zone}",
                site=n.site,
            )


class HealthCheckView(APIView):
    permission_classes = [permissions.AllowAny]
    def get(self, request):
        return Response({
            "status": "healthy",
            "contract_version": 2,
            "service": "Compallette Mining Safety Django Backend",
            "version": "2.0.0",
            "build_revision": settings.COMPALLETTE_BUILD_REVISION,
            "database": settings.DATABASES['default']['ENGINE'].split('.')[-1],
        })


class TelemetryIngestView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    def get_authenticate_header(self, request):
        return 'Gateway'
    def post(self, request):
        from .ingestion import authenticate_gateway, ingest
        gateway = authenticate_gateway(request.headers.get('X-Gateway-ID'), request.headers.get('X-API-Key'))
        if not isinstance(request.data, dict) or request.data.get('type') != 'TELEMETRY':
            return Response({'error': 'Unexpected event type.', 'error_code': 'VALIDATION_ERROR'}, status=400)
        return Response(ingest(gateway, request.data))


class AlertIngestView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    def get_authenticate_header(self, request):
        return 'Gateway'
    def post(self, request):
        from .ingestion import authenticate_gateway, ingest
        gateway = authenticate_gateway(request.headers.get('X-Gateway-ID'), request.headers.get('X-API-Key'))
        if not isinstance(request.data, dict) or request.data.get('type') != 'ALERT':
            return Response({'error': 'Unexpected event type.', 'error_code': 'VALIDATION_ERROR'}, status=400)
        return Response(ingest(gateway, request.data))


class HeartbeatIngestView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    def get_authenticate_header(self, request):
        return 'Gateway'
    def post(self, request):
        from .ingestion import authenticate_gateway, ingest
        gateway = authenticate_gateway(request.headers.get('X-Gateway-ID'), request.headers.get('X-API-Key'))
        if not isinstance(request.data, dict) or request.data.get('type') != 'HEARTBEAT':
            return Response({'error': 'Unexpected event type.', 'error_code': 'VALIDATION_ERROR'}, status=400)
        return Response(ingest(gateway, request.data))


class SystemSummaryView(APIView):
    def get(self, request):
        site = resolve_site(request)
        nodes = Node.objects.filter(site=site) if site else Node.objects.none()
        alerts = SafetyAlert.objects.filter(site=site) if site else SafetyAlert.objects.none()
        total = nodes.count()
        online_miners = nodes.filter(role=NodeRole.WEARABLE, status=NodeStatus.ONLINE).count()
        stale = nodes.filter(status=NodeStatus.STALE).count()
        offline = nodes.filter(status=NodeStatus.OFFLINE).count()

        new_alerts = alerts.filter(status=AlertStatus.NEW).count()
        crit_emergencies = alerts.filter(status=AlertStatus.NEW, severity=AlertSeverity.CRITICAL).count()
        ack_in_progress = alerts.filter(status=AlertStatus.ACKNOWLEDGED).count()

        gas_warn = nodes.filter(latest_co__gte=settings.CO_WARN_PPM, latest_co__lt=settings.CO_CRIT_PPM).count()
        gas_crit = nodes.filter(latest_co__gte=settings.CO_CRIT_PPM).count()

        last_telem = TelemetryRecord.objects.filter(site=site).order_by('-received_at').first() if site else None
        last_node = nodes.order_by('-last_seen_ts').first()
        last_telem_rx = last_telem.received_at if last_telem else 0
        last_node_rx = last_node.last_seen_ts if last_node else 0
        last_rx = max(last_telem_rx, last_node_rx)

        return Response({
            "total_nodes_tracked": total,
            "online_miners": online_miners,
            "stale_nodes": stale,
            "offline_nodes": offline,
            "active_unacknowledged_alerts": new_alerts,
            "critical_emergencies": crit_emergencies,
            "acknowledged_in_progress": ack_in_progress,
            "miners_in_gas_warning": gas_warn,
            "miners_in_gas_critical": gas_crit,
            "last_packet_received_ms": last_rx
        })


class NodeListView(APIView):
    def get(self, request):
        status_q = request.query_params.get("status")
        active_q = request.query_params.get("active")

        site = resolve_site(request)
        queryset = Node.objects.filter(site=site).order_by('node_id') if site else Node.objects.none()

        if status_q:
            sq = status_q.upper()
            if sq in ['ACTIVE', 'ONLINE']:
                queryset = queryset.filter(status=NodeStatus.ONLINE)
            elif sq in ['INACTIVE', 'OFFLINE']:
                queryset = queryset.filter(status__in=[NodeStatus.OFFLINE, NodeStatus.STALE])
            elif sq == 'STALE':
                queryset = queryset.filter(status=NodeStatus.STALE)
            elif sq != 'ALL':
                queryset = queryset.filter(status=sq)
        elif active_q is not None:
            if active_q.lower() in ['true', '1', 'active']:
                queryset = queryset.filter(status=NodeStatus.ONLINE)
            elif active_q.lower() in ['false', '0', 'inactive']:
                queryset = queryset.filter(status__in=[NodeStatus.OFFLINE, NodeStatus.STALE])

        serializer = NodeSerializer(queryset, many=True)
        return Response({"nodes": serializer.data, "count": len(serializer.data)})


class NodeDetailView(APIView):
    def get(self, request, node_id):
        node = get_object_or_404(Node.objects.filter(site__in=permitted_sites(request.user)), node_id=node_id)
        serializer = NodeSerializer(node)
        return Response({
            'node': serializer.data,
            'capabilities': DeviceCapabilitySerializer(node.capabilities.filter(active=True), many=True).data,
            'recent_measurements': MeasurementReadingSerializer(node.measurements.filter(site__in=permitted_sites(request.user))[:20], many=True).data,
        })


class NodeHistoryView(APIView):
    def get(self, request, node_id):
        node = get_object_or_404(Node.objects.filter(site__in=permitted_sites(request.user)), node_id=node_id)
        limit = int(request.query_params.get("limit", 50))
        records = TelemetryRecord.objects.filter(node=node, site__in=permitted_sites(request.user)).order_by('-received_at')[:limit]
        serializer = TelemetryRecordSerializer(records, many=True)
        return Response({
            "node_id": node_id,
            "history": serializer.data,
            "count": len(serializer.data)
        })


class AlertListView(APIView):
    def get(self, request):
        status_q = request.query_params.get("status")
        sev_q = request.query_params.get("severity")
        limit = int(request.query_params.get("limit", 100))

        site = resolve_site(request)
        queryset = SafetyAlert.objects.filter(site=site) if site else SafetyAlert.objects.none()
        if status_q:
            queryset = queryset.filter(status=status_q)
        if sev_q:
            queryset = queryset.filter(severity=sev_q)

        alerts = queryset.order_by('-created_at')[:limit]
        serializer = SafetyAlertSerializer(alerts, many=True)
        return Response({"alerts": serializer.data, "count": len(serializer.data)})


class AlertDetailView(APIView):
    def get(self, request, alert_id):
        alert = get_object_or_404(SafetyAlert.objects.filter(site__in=permitted_sites(request.user)), id=alert_id)
        serializer = SafetyAlertSerializer(alert)
        return Response(serializer.data)


class AlertAcknowledgeView(APIView):
    @transaction.atomic
    def post(self, request, alert_id):
        denied = require_capability(request, 'operate_alerts')
        if denied:
            return denied
        alert = get_object_or_404(SafetyAlert.objects.select_for_update().filter(site__in=permitted_sites(request.user)), id=alert_id)
        if alert.status != AlertStatus.NEW:
            return Response({"error": "Alert not found or already acknowledged/resolved", "alert_id": alert_id}, status=status.HTTP_404_NOT_FOUND)

        officer = request.user.get_username()
        now_ms = int(time.time() * 1000)

        alert.status = AlertStatus.ACKNOWLEDGED
        alert.acknowledged_at = now_ms
        alert.acknowledged_by = officer
        alert.save()

        AuditEntry.objects.create(
            timestamp=now_ms,
            actor=officer,
            action='ALERT_ACKNOWLEDGED',
            details=f"Alert #{alert.id} acknowledged by {officer}",
            site=alert.site,
        )

        return Response({"status": "ok", "message": f"Alert #{alert.id} acknowledged", "alert_id": alert.id})


class AlertResolveView(APIView):
    @transaction.atomic
    def post(self, request, alert_id):
        denied = require_capability(request, 'operate_alerts')
        if denied:
            return denied
        alert = get_object_or_404(SafetyAlert.objects.select_for_update().filter(site__in=permitted_sites(request.user)), id=alert_id)
        if alert.status == AlertStatus.RESOLVED:
            return Response({"error": "Alert already resolved", "alert_id": alert_id}, status=status.HTTP_404_NOT_FOUND)

        officer = request.user.get_username()
        notes = request.data.get("notes")
        if not isinstance(notes, str) or not notes.strip():
            return Response({"error": "Resolution notes are required."}, status=status.HTTP_400_BAD_REQUEST)
        notes = notes.strip()
        now_ms = int(time.time() * 1000)

        alert.status = AlertStatus.RESOLVED
        alert.resolved_at = now_ms
        alert.resolved_by = officer
        alert.resolution_notes = notes
        alert.save()

        AuditEntry.objects.create(
            timestamp=now_ms,
            actor=officer,
            action='ALERT_RESOLVED',
            details=f"Alert #{alert.id} resolved: {notes}",
            site=alert.site,
        )

        return Response({"status": "ok", "message": f"Alert #{alert.id} resolved", "alert_id": alert.id})


class AuditListView(APIView):
    def get(self, request):
        denied = require_capability(request, 'view_audit')
        if denied:
            return denied
        limit = int(request.query_params.get("limit", 20))
        offset = int(request.query_params.get("offset", 0))
        site = resolve_site(request)
        if not site:
            return Response({"audit_log": [], "count": 0, "total": 0})
        
        qs = AuditEntry.objects.filter(site=site).order_by('-timestamp')
        total = qs.count()
        entries = qs[offset:offset + limit]
        serializer = AuditEntrySerializer(entries, many=True)
        return Response({
            "audit_log": serializer.data,
            "count": len(serializer.data),
            "total": total,
            "offset": offset,
            "limit": limit,
        })


# ============================================================================
# DYNAMIC PROVISIONING VIEWS (Option 1: Over-The-Air Mesh Enrollment)
# ============================================================================

class ProvisioningRequestIngestView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    def get_authenticate_header(self, request):
        return 'Gateway'
    def post(self, request):
        from .ingestion import authenticate_gateway, ingest
        gateway = authenticate_gateway(request.headers.get('X-Gateway-ID'), request.headers.get('X-API-Key'))
        if request.data.get('type') != 'PROV_REQ':
            return Response({'error': 'Expected discovery request.'}, status=400)
        return Response(ingest(gateway, request.data))


class ProvisioningPendingListView(APIView):
    def get(self, request):
        denied = require_capability(request, 'manage_devices')
        if denied:
            return denied
        from .models import DeviceDiscovery
        site = resolve_site(request)
        return Response({'pending_nodes': list(DeviceDiscovery.objects.filter(gateway__site=site).values())})


class ProvisioningAssignView(APIView):
    def post(self, request):
        return Response({'error': 'Use /api/v1/commands with an explicit gateway and discovery identity.', 'error_code': 'RETIRED_OPERATION'}, status=410)


class ProvisioningConfirmView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    def get_authenticate_header(self, request):
        return 'Gateway'
    def post(self, request):
        from .ingestion import authenticate_gateway
        from .device_trust import accept_result
        gateway = authenticate_gateway(request.headers.get('X-Gateway-ID'), request.headers.get('X-API-Key'))
        return Response(accept_result(gateway, request.data))


class PlatformBootstrapView(APIView):
    """Returns only the topology the current operator is permitted to see."""
    def get(self, request):
        sites = permitted_sites(request.user).select_related('organisation')
        organisations = Organisation.objects.filter(id__in=sites.values('organisation_id').distinct())
        return Response({
            'contract_version': 2,
            'build_revision': settings.COMPALLETTE_BUILD_REVISION,
            'organisations': OrganisationSerializer(organisations, many=True).data,
            'sites': SiteSerializer(sites, many=True).data,
            'capabilities': operator_capabilities(request.user, resolve_site(request)),
            'site_capabilities': {str(site.pk): operator_capabilities(request.user, site) for site in permitted_sites(request.user)},
        })


class SiteListCreateView(APIView):
    def get(self, request):
        return Response({'sites': SiteSerializer(permitted_sites(request.user), many=True).data})

    def post(self, request):
        denied = require_capability(request, 'manage_sites')
        if denied:
            return denied
        serializer = SiteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        organisation = serializer.validated_data['organisation']
        if not request.user.is_superuser and not SiteMembership.objects.filter(user=request.user, organisation=organisation, organisation__active=True, site__isnull=True, active=True, role=MembershipRole.ORG_ADMIN).exists():
            return Response({'error': 'You cannot create a site for this organisation.'}, status=status.HTTP_403_FORBIDDEN)
        site = serializer.save()
        FacilityLayout.objects.get_or_create(site=site, defaults={'geometry': {'version': 1, 'features': []}})
        return Response(SiteSerializer(site).data, status=status.HTTP_201_CREATED)


class SiteDetailView(APIView):
    def get_object(self, request, site_id):
        return get_object_or_404(permitted_sites(request.user), pk=site_id)

    def get(self, request, site_id):
        return Response(SiteSerializer(self.get_object(request, site_id)).data)

    def patch(self, request, site_id):
        denied = require_capability(request, 'manage_sites')
        if denied:
            return denied
        serializer = SiteSerializer(self.get_object(request, site_id), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return Response(SiteSerializer(serializer.save()).data)


class SiteStructuresView(APIView):
    def get_site(self, request, site_id):
        return get_object_or_404(permitted_sites(request.user), pk=site_id)

    def get(self, request, site_id):
        return Response({'structures': StructureSerializer(Structure.objects.filter(site=self.get_site(request, site_id)), many=True).data})

    def post(self, request, site_id):
        denied = require_capability(request, 'manage_sites')
        if denied:
            return denied
        data = {**request.data, 'site': site_id}
        serializer = StructureSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        return Response(StructureSerializer(serializer.save()).data, status=status.HTTP_201_CREATED)


class StructureLevelsView(APIView):
    def get(self, request, structure_id):
        structure = get_object_or_404(Structure.objects.filter(site__in=permitted_sites(request.user)), pk=structure_id)
        return Response({'levels': LevelSerializer(structure.levels.all(), many=True).data})

    def post(self, request, structure_id):
        denied = require_capability(request, 'manage_sites')
        if denied:
            return denied
        structure = get_object_or_404(Structure.objects.filter(site__in=permitted_sites(request.user)), pk=structure_id)
        serializer = LevelSerializer(data={**request.data, 'structure': structure.id})
        serializer.is_valid(raise_exception=True)
        return Response(LevelSerializer(serializer.save()).data, status=status.HTTP_201_CREATED)


class SiteZonesView(APIView):
    def get_site(self, request, site_id):
        return get_object_or_404(permitted_sites(request.user), pk=site_id)

    def get(self, request, site_id):
        return Response({'zones': ZoneSerializer(Zone.objects.filter(site=self.get_site(request, site_id)), many=True).data})

    def post(self, request, site_id):
        denied = require_capability(request, 'manage_sites')
        if denied:
            return denied
        serializer = ZoneSerializer(data={**request.data, 'site': site_id})
        serializer.is_valid(raise_exception=True)
        return Response(ZoneSerializer(serializer.save()).data, status=status.HTTP_201_CREATED)


class ZoneDetailView(APIView):
    def get_object(self, request, zone_id):
        return get_object_or_404(Zone.objects.filter(site__in=permitted_sites(request.user)), pk=zone_id)

    def patch(self, request, zone_id):
        denied = require_capability(request, 'manage_sites')
        if denied:
            return denied
        serializer = ZoneSerializer(self.get_object(request, zone_id), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return Response(ZoneSerializer(serializer.save()).data)


class FacilityLayoutView(APIView):
    def get_site(self, request, site_id):
        return get_object_or_404(permitted_sites(request.user), pk=site_id)

    def get(self, request, site_id):
        site = self.get_site(request, site_id)
        layout = FacilityLayout.objects.filter(site=site).first()
        return Response(FacilityLayoutSerializer(layout).data if layout else {
            'site': site.pk, 'version': 0, 'geometry': {'features': []}, 'updated_at': None})

    @transaction.atomic
    def put(self, request, site_id):
        denied = require_capability(request, 'manage_sites')
        if denied:
            return denied
        site = get_object_or_404(permitted_sites(request.user).select_for_update(), pk=site_id)
        layout = FacilityLayout.objects.filter(site=site).first()
        version = layout.version if layout else 0
        expected = request.data.get('expected_version')
        if type(expected) is not int or expected != version:
            return Response({'error': 'Layout changed. Reload before saving.', 'version': version}, status=409)
        geometry = request.data.get('geometry')
        if not isinstance(geometry, dict) or not isinstance(geometry.get('features'), list):
            return Response({'error': 'geometry must contain a features array.'}, status=400)
        zone_ids = set(Zone.objects.filter(site=site, active=True).values_list('pk', flat=True))
        feature_ids = set()
        for feature in geometry['features']:
            if not isinstance(feature, dict) or not isinstance(feature.get('properties', {}), dict):
                return Response({'error': 'Each feature must be an object with object properties.'}, status=400)
            feature_id = feature.get('id')
            if not isinstance(feature_id, str) or not feature_id.strip() or feature_id in feature_ids:
                return Response({'error': 'Each feature requires a unique, stable string id.'}, status=400)
            feature_ids.add(feature_id)
            properties = feature.get('properties', {})
            zone_id = properties.get('zone_id')
            if zone_id is not None and (type(zone_id) is not int or zone_id not in zone_ids):
                return Response({'error': 'Feature zone_id must reference an active zone in this site.'}, status=400)
            if ('zone_code' in properties or 'zone_code' in feature) and zone_id is None:
                return Response({'error': 'Zone features require a stable properties.zone_id.'}, status=400)
        if layout is None:
            layout = FacilityLayout(site=site)
        layout.geometry = geometry
        layout.version = version + 1
        layout.save()
        from .operations import audit
        audit(request.user, site, 'LAYOUT_UPDATED', site, {'version': layout.version})
        return Response(FacilityLayoutSerializer(layout).data)


class PersonnelListCreateView(APIView):
    def get(self, request):
        site = resolve_site(request)
        if not site:
            return Response({'personnel': [], 'count': 0})
        query = request.query_params.get('q', '').strip()
        records = Personnel.objects.filter(site=site).select_related('assigned_node')
        if query:
            records = records.filter(Q(identifier__icontains=query) | Q(display_name__icontains=query) | Q(team__icontains=query))
        return Response({'personnel': PersonnelSerializer(records, many=True).data, 'count': records.count()})

    def post(self, request):
        denied = require_capability(request, 'manage_assets')
        if denied:
            return denied
        site = resolve_site(request)
        if not site:
            return Response({'error': 'Select a permitted site before registering personnel.'}, status=status.HTTP_400_BAD_REQUEST)
        serializer = PersonnelSerializer(data={**request.data, 'site': site.id, 'organisation': site.organisation_id})
        serializer.is_valid(raise_exception=True)
        assigned_node = serializer.validated_data.get('assigned_node')
        if assigned_node and assigned_node.site_id != site.id:
            return Response({'error': 'Assigned device must belong to the selected site.'}, status=status.HTTP_400_BAD_REQUEST)
        person = serializer.save()
        return Response(PersonnelSerializer(person).data, status=status.HTTP_201_CREATED)


class PersonnelDetailView(APIView):
    def get(self, request, person_id):
        person = get_object_or_404(Personnel.objects.select_related('assigned_node'), pk=person_id, site__in=permitted_sites(request.user))
        return Response(PersonnelSerializer(person).data)


class AssetListCreateView(APIView):
    def get(self, request):
        site = resolve_site(request)
        if not site:
            return Response({'assets': [], 'count': 0})
        query = request.query_params.get('q', '').strip()
        records = Asset.objects.filter(site=site).select_related('assigned_node')
        if query:
            records = records.filter(Q(identifier__icontains=query) | Q(name__icontains=query) | Q(asset_type__icontains=query))
        return Response({'assets': AssetSerializer(records, many=True).data, 'count': records.count()})

    def post(self, request):
        denied = require_capability(request, 'manage_assets')
        if denied:
            return denied
        site = resolve_site(request)
        if not site:
            return Response({'error': 'Select a permitted site before registering an asset.'}, status=status.HTTP_400_BAD_REQUEST)
        serializer = AssetSerializer(data={**request.data, 'site': site.id, 'organisation': site.organisation_id})
        serializer.is_valid(raise_exception=True)
        assigned_node = serializer.validated_data.get('assigned_node')
        if assigned_node and assigned_node.site_id != site.id:
            return Response({'error': 'Assigned device must belong to the selected site.'}, status=status.HTTP_400_BAD_REQUEST)
        asset = serializer.save()
        return Response(AssetSerializer(asset).data, status=status.HTTP_201_CREATED)


class AssetDetailView(APIView):
    def get(self, request, asset_id):
        asset = get_object_or_404(Asset.objects.select_related('assigned_node'), pk=asset_id, site__in=permitted_sites(request.user))
        return Response(AssetSerializer(asset).data)


class DashboardView(APIView):
    def get(self, request):
        site = resolve_site(request)
        if not site:
            return Response({'site': None, 'metrics': {}, 'alerts': [], 'environment': [], 'activity': []})
        nodes = Node.objects.filter(site=site)
        alerts = SafetyAlert.objects.filter(site=site).exclude(status=AlertStatus.RESOLVED)

        active_alert_count = alerts.count()
        critical_alert_count = alerts.filter(severity=AlertSeverity.CRITICAL).count()
        online_personnel_count = Personnel.objects.filter(site=site, assigned_node__status=NodeStatus.ONLINE).count()
        tracked_asset_count = Asset.objects.filter(site=site).count()
        online_device_count = nodes.filter(status=NodeStatus.ONLINE).count()
        stale_device_count = nodes.filter(status__in=[NodeStatus.STALE, NodeStatus.OFFLINE]).count()

        # Fast channel snapshot: order_by() clears model Meta ordering to avoid PostgreSQL scanning all 15k rows for distinct
        distinct_keys = list(
            MeasurementReading.objects.filter(site=site, source_event__locationobservation__simulated=False)
            .order_by()
            .values_list('node_id', 'measurement_key')
            .distinct()
        )
        latest_by_key = []
        for stream_node, key in distinct_keys:
            item = (
                MeasurementReading.objects.filter(site=site, node_id=stream_node, measurement_key=key, source_event__locationobservation__simulated=False)
                .select_related('node')
                .order_by('-received_at')
                .first()
            )
            if item:
                latest_by_key.append(item)

        from django.db.models import Avg
        now = int(time.time() * 1000)
        hour_ms = 3600 * 1000
        primary_timeline = []
        physical = MeasurementReading.objects.filter(site=site, source_event__locationobservation__simulated=False)
        for h in range(11, -1, -1):
            start = now - ((h + 1) * hour_ms)
            end = start + hour_ms
            readings = physical.filter(received_at__gte=start, received_at__lt=end)
            gas = readings.filter(measurement_key='co_ppm').aggregate(value=Avg('value'))['value']
            dust = readings.filter(measurement_key='dust_ugm3').aggregate(value=Avg('value'))['value']
            count = SafetyAlert.objects.filter(site=site, created_at__lte=end).filter(Q(resolved_at__isnull=True) | Q(resolved_at__gt=end)).count()
            if gas is not None or dust is not None or count:
                primary_timeline.append({'timestamp': end, 'label': '', 'gas_ppm': gas,
                    'dust_ugm3': dust, 'active_alerts': count})

        # Severity breakdown
        info_count = alerts.filter(severity=AlertSeverity.INFO).count()
        warn_count = alerts.filter(severity=AlertSeverity.WARNING).count()
        severity_breakdown = [
            {'label': 'Critical', 'count': critical_alert_count, 'color': '#c42a2a'},
            {'label': 'Warning', 'count': warn_count, 'color': '#b96700'},
            {'label': 'Info', 'count': info_count, 'color': '#1666d9'},
        ]

        # Zone occupancy
        zone_occupancy = []
        for z in Zone.objects.filter(site=site)[:6]:
            person_count = Personnel.objects.filter(site=site, assigned_node__zone_ref=z).count()
            asset_z_count = Asset.objects.filter(site=site, assigned_node__zone_ref=z).count()
            zone_occupancy.append({
                'zone': z.name or z.code,
                'personnel_count': person_count,
                'asset_count': asset_z_count,
            })

        # System notifications
        system_notifications = []
        if stale_device_count > 0:
            system_notifications.append({
                'id': 'notif-stale-devices',
                'severity': 'WARNING',
                'title': f'{stale_device_count} Node(s) Unreachable',
                'message': f'Sensor heartbeats missed for {stale_device_count} nodes in {site.name}. Check gateway connectivity.',
                'timestamp': now,
                'action_required': True,
                'action_label': 'Inspect Devices',
                'action_route': '/devices',
            })
        if critical_alert_count > 0:
            system_notifications.append({
                'id': 'notif-critical-alarms',
                'severity': 'CRITICAL',
                'title': f'{critical_alert_count} Unacknowledged Critical Alarm(s)',
                'message': 'Immediate investigation required under site procedures.',
                'timestamp': now,
                'action_required': True,
                'action_label': 'View Incidents',
                'action_route': '/alerts',
            })

        return Response({
            'site': SiteSerializer(site).data,
            'metrics': {
                'online_personnel': online_personnel_count,
                'tracked_assets': tracked_asset_count,
                'active_alerts': active_alert_count,
                'critical_alerts': critical_alert_count,
                'online_devices': online_device_count,
                'stale_or_offline_devices': stale_device_count,
            },
            'trends': {},
            'aggregation': 'Hourly mean of non-simulated readings; alarms active at bucket end.',
            'charts': {
                'primary_timeline': primary_timeline,
                'severity_breakdown': severity_breakdown,
                'zone_occupancy': zone_occupancy,
            },
            'system_notifications': system_notifications,
            'alerts': SafetyAlertSerializer(alerts.order_by('-created_at')[:8], many=True).data,
            'environment': MeasurementReadingSerializer(latest_by_key, many=True).data,
            'activity': AuditEntrySerializer(AuditEntry.objects.filter(site=site).order_by('-timestamp')[:12], many=True).data,
        })


class EnvironmentOverviewView(APIView):
    def get(self, request):
        site = resolve_site(request)
        if not site:
            return Response({'channels': [], 'readings': []})
        
        # Optimized database query: only extract the distinct measurement keys
        # and fetch their latest single reading without loading full table scans.
        # Calling .order_by() without args clears the default Meta ordering (-received_at)
        # which allows PostgreSQL to use a distinct index scan rather than a full sort.
        distinct_keys = list(
            MeasurementReading.objects.filter(site=site, source_event__locationobservation__simulated=False)
            .order_by()
            .values_list('node_id', 'measurement_key')
            .distinct()
        )
        
        channels = []
        latest_readings = []
        for stream_node, key in distinct_keys:
            latest = (
                MeasurementReading.objects.filter(site=site, node_id=stream_node, measurement_key=key, source_event__locationobservation__simulated=False)
                .select_related('node', 'capability')
                .order_by('-received_at')
                .first()
            )
            if latest:
                latest_readings.append(latest)
                channels.append({
                    'key': f'{latest.node_id}:{key}',
                    'measurement_key': key,
                    'display_name': latest.capability.display_name if latest.capability else key,
                    'unit': latest.unit,
                    'latest_value': latest.value,
                    'latest_at': latest.received_at,
                    'node_id': latest.node.node_id,
                    'zone': latest.zone,
                    'sensor_ok': latest.node.sensor_ok,
                })
        
        return Response({
            'channels': channels,
            'readings': MeasurementReadingSerializer(latest_readings, many=True).data,
        })


class EnvironmentReadingsView(APIView):
    def get(self, request):
        site = resolve_site(request)
        if not site:
            return Response({'readings': [], 'total': 0, 'page': 1, 'page_size': 25, 'total_pages': 1})
        
        readings_qs = MeasurementReading.objects.filter(site=site, source_event__locationobservation__simulated=False).select_related('node', 'capability')
        key = request.query_params.get('key')
        if key:
            if ':' not in key:
                return Response({'error': 'Select a device-specific measurement stream.'}, status=400)
            stream_node, measurement_key = key.split(':', 1)
            readings_qs = readings_qs.filter(node_id=stream_node, measurement_key=measurement_key)
            
        readings_qs = readings_qs.order_by('-received_at')
        total = readings_qs.count()

        try:
            page = max(1, int(request.query_params.get('page', 1)))
            page_size = max(5, min(100, int(request.query_params.get('page_size', 25))))
        except ValueError:
            page = 1
            page_size = 25

        start = (page - 1) * page_size
        end = start + page_size
        paginated_records = readings_qs[start:end]
        total_pages = max(1, (total + page_size - 1) // page_size)

        return Response({
            'readings': MeasurementReadingSerializer(paginated_records, many=True).data,
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': total_pages,
        })


class DigitalTwinView(APIView):
    def get(self, request):
        site = resolve_site(request)
        if not site:
            return Response({'site': None, 'layout': None, 'zones': [], 'entities': []})
        layout = FacilityLayout.objects.filter(site=site).first()
        nodes = Node.objects.filter(site=site).select_related('zone_ref', 'assigned_person', 'assigned_asset')
        entities = []
        for node in nodes:
            person = getattr(node, 'assigned_person', None)
            asset = getattr(node, 'assigned_asset', None)
            entities.append({
                'id': node.node_id,
                'kind': 'personnel' if person else ('asset' if asset else 'device'),
                'label': getattr(person, 'display_name', None) or getattr(asset, 'name', None) or node.node_id,
                'node_id': node.node_id,
                'zone_id': node.zone_ref_id,
                'zone_code': node.current_zone,
                'status': node.status,
                'evidence': node.location_evidence,
                'observed_at': node.location_observed_at,
                'role': node.role,
            })
        return Response({
            'site': SiteSerializer(site).data,
            'layout': FacilityLayoutSerializer(layout).data if layout else {'site': site.pk, 'version': 0, 'geometry': {'features': []}, 'updated_at': None},
            'zones': ZoneSerializer(site.zones.all(), many=True).data,
            'entities': entities,
            'topology': [],
            'topology_status': 'UNAVAILABLE_PENDING_VALIDATED_DIRECT_LINK_EVIDENCE',
        })


class SearchView(APIView):
    def get(self, request):
        site = resolve_site(request)
        query = request.query_params.get('q', '').strip()
        if not site or not query:
            return Response({'results': []})
        results = []
        for node in Node.objects.filter(site=site, node_id__icontains=query)[:5]:
            results.append({'kind': 'device', 'id': node.node_id, 'label': node.node_id, 'route': f'/devices/{node.node_id}'})
        for person in Personnel.objects.filter(site=site).filter(Q(identifier__icontains=query) | Q(display_name__icontains=query))[:5]:
            results.append({'kind': 'personnel', 'id': person.id, 'label': person.display_name, 'route': f'/personnel/{person.id}'})
        for asset in Asset.objects.filter(site=site).filter(Q(identifier__icontains=query) | Q(name__icontains=query))[:5]:
            results.append({'kind': 'asset', 'id': asset.id, 'label': asset.name, 'route': f'/assets/{asset.id}'})
        for zone in Zone.objects.filter(site=site).filter(Q(code__icontains=query) | Q(name__icontains=query))[:5]:
            results.append({'kind': 'zone', 'id': zone.id, 'label': zone.name, 'route': f'/sites-zones?zone={zone.id}'})
        return Response({'results': results})


class AlertAssignView(APIView):
    @transaction.atomic
    def post(self, request, alert_id):
        denied = require_capability(request, 'operate_alerts')
        if denied:
            return denied
        alert = get_object_or_404(SafetyAlert.objects.select_for_update().filter(site__in=permitted_sites(request.user)), id=alert_id)
        if alert.status == AlertStatus.RESOLVED:
            return Response({'error': 'Resolved alerts cannot be assigned.', 'alert_id': alert_id}, status=status.HTTP_409_CONFLICT)
        notes = str(request.data.get('notes', '')).strip()
        alert.assigned_to = request.user
        alert.assigned_at = int(time.time() * 1000)
        alert.investigation_notes = notes
        alert.status = AlertStatus.INVESTIGATING
        alert.save(update_fields=['assigned_to', 'assigned_at', 'investigation_notes', 'status'])
        AuditEntry.objects.create(timestamp=alert.assigned_at, actor=request.user.get_username(), action='ALERT_ASSIGNED', details=f'Alert #{alert.id} assigned: {notes}', site=alert.site)
        return Response({'status': 'ok', 'alert_id': alert.id})


class ReportSummaryView(APIView):
    def get(self, request):
        site = resolve_site(request)
        if not site:
            return Response({'site': None, 'summary': {}})
        return Response({'site': SiteSerializer(site).data, 'summary': {
            'telemetry_records': TelemetryRecord.objects.filter(site=site).count(),
            'measurement_records': MeasurementReading.objects.filter(site=site).count(),
            'alerts_total': SafetyAlert.objects.filter(site=site).count(),
            'personnel_total': Personnel.objects.filter(site=site).count(),
            'assets_total': Asset.objects.filter(site=site).count(),
        }})


class IntegrationsView(APIView):
    def get(self, request):
        return Response({'integrations': [], 'message': 'No external integrations are configured.'})


class SiteMembershipListCreateView(APIView):
    def get(self, request):
        denied = require_capability(request, 'manage_users')
        if denied:
            return denied
        site = resolve_site(request)
        if not site:
            return Response({'memberships': []})
        memberships = SiteMembership.objects.filter(organisation=site.organisation).filter(Q(site=site) | Q(site__isnull=True)).select_related('user', 'site', 'organisation')
        return Response({'memberships': SiteMembershipSerializer(memberships, many=True).data})

    @transaction.atomic
    def post(self, request):
        denied = require_capability(request, 'manage_users')
        if denied:
            return denied
        site = resolve_site(request)
        if not site:
            return Response({'error': 'Select a permitted site before assigning access.'}, status=status.HTTP_400_BAD_REQUEST)
        username = str(request.data.get('username', '')).strip()
        role = str(request.data.get('role', MembershipRole.VIEWER))
        if not username or role not in MembershipRole.values:
            return Response({'error': 'A valid username and role are required.'}, status=status.HTTP_400_BAD_REQUEST)
        # Serialize membership changes with the account administration endpoints.
        user = get_object_or_404(get_user_model().objects.select_for_update(), username=username)
        existing = SiteMembership.objects.filter(user=user, organisation=site.organisation, site=site).first()
        if not request.user.is_superuser and (role == MembershipRole.ORG_ADMIN or (existing and existing.role == MembershipRole.ORG_ADMIN)):
            return Response({'error': 'Organisation administrator changes require a superuser.'}, status=403)
        membership, _ = SiteMembership.objects.update_or_create(
            user=user,
            organisation=site.organisation,
            site=site,
            defaults={'role': role, 'active': True},
        )
        AuditEntry.objects.create(
            timestamp=int(time.time() * 1000),
            actor=request.user.get_username(),
            action='ACCESS_ASSIGNED',
            details=f"{username} assigned {role} for {site.code}",
            site=site,
        )
        return Response(SiteMembershipSerializer(membership).data, status=status.HTTP_201_CREATED)



from .account_views import (UserListCreateView, UserDetailView, UserBulkActionView, UserPasswordResetView)
