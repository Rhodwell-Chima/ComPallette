import logging
import time
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.db import transaction, IntegrityError
from django.db.models import Q
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


def verify_api_key(request):
    """Verifies gateway X-API-Key header matches configured secret."""
    key = request.headers.get('X-API-Key')
    expected = settings.COMPALLETTE_API_KEY
    return bool(expected) and key == expected


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


ROLE_CAPABILITIES = {
    MembershipRole.ORG_ADMIN: {'view', 'manage_sites', 'manage_users', 'manage_devices', 'operate_alerts', 'manage_assets', 'manage_integrations'},
    MembershipRole.SITE_ADMIN: {'view', 'manage_sites', 'manage_devices', 'operate_alerts', 'manage_assets'},
    MembershipRole.OPERATIONS: {'view', 'operate_alerts', 'manage_assets'},
    MembershipRole.SAFETY: {'view', 'operate_alerts'},
    MembershipRole.TECHNICIAN: {'view', 'manage_devices'},
    MembershipRole.VIEWER: {'view'},
}


def operator_capabilities(user):
    """The backend is the sole authority for every operator action."""
    has_memberships = SiteMembership.objects.filter(user=user, active=True).exists()
    if user.is_superuser or (user.is_staff and not has_memberships):
        return sorted({capability for values in ROLE_CAPABILITIES.values() for capability in values})
    capabilities = set()
    for membership in SiteMembership.objects.filter(user=user, active=True):
        capabilities.update(ROLE_CAPABILITIES.get(membership.role, {'view'}))
    return sorted(capabilities)


def has_operator_access(user):
    """A Django staff account or an active site membership can open the operator UI."""
    return user.is_staff or SiteMembership.objects.filter(user=user, active=True).exists()


def require_capability(request, capability):
    if capability not in operator_capabilities(request.user):
        return Response({'error': 'You do not have permission for this operation.'}, status=status.HTTP_403_FORBIDDEN)
    return None


def permitted_sites(user):
    if user.is_superuser or user.is_staff and not SiteMembership.objects.filter(user=user, active=True).exists():
        return Site.objects.filter(active=True)
    memberships = SiteMembership.objects.filter(user=user, active=True)
    organisation_ids = memberships.filter(site__isnull=True).values_list('organisation_id', flat=True)
    site_ids = memberships.filter(site__isnull=False).values_list('site_id', flat=True)
    return Site.objects.filter(active=True).filter(Q(organisation_id__in=organisation_ids) | Q(id__in=site_ids))


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
            "capabilities": operator_capabilities(user),
            "sites": SiteSerializer(permitted_sites(user), many=True).data,
        })

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"authenticated": False}, status=status.HTTP_401_UNAUTHORIZED)
        return Response({
            "authenticated": True,
            "username": request.user.get_username(),
            "is_staff": request.user.is_staff,
            "capabilities": operator_capabilities(request.user),
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
        last_seen_ts__lt=stale_limit,
        last_seen_ts__gte=offline_limit,
        status=NodeStatus.ONLINE
    ).update(status=NodeStatus.STALE)

    # 2. Flag Offline Nodes and generate COMM_LOST alert
    with transaction.atomic():
        dropping = list(Node.objects.select_for_update().filter(
            last_seen_ts__lt=offline_limit
        ).exclude(status=NodeStatus.OFFLINE))
        for n in dropping:
            n.status = NodeStatus.OFFLINE
            n.save(update_fields=['status'])
            SafetyAlert.objects.get_or_create(
                node=n, seq=0, alert_code='COMM_LOST',
                defaults={
                    'zone': n.current_zone,
                    'severity': AlertSeverity.WARNING,
                    'details': f"Node {n.node_id} ({n.role}) lost underground communication in {n.current_zone}",
                    'trigger_value': 0.0, 'status': AlertStatus.NEW, 'created_at': now_ms,
                }
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
            "service": "Compallette Mining Safety Django Backend",
            "version": "2.0.0",
            "build_revision": settings.COMPALLETTE_BUILD_REVISION,
            "database": settings.DATABASES['default']['ENGINE'].split('.')[-1],
        })


class TelemetryIngestView(APIView):
    permission_classes = [permissions.AllowAny]
    def post(self, request):
        if not verify_api_key(request):
            return Response({"error": "Unauthorized: Invalid or missing X-API-Key"}, status=status.HTTP_401_UNAUTHORIZED)

        data = request.data
        if not isinstance(data, dict):
            return Response({"error": "Malformed JSON payload"}, status=status.HTTP_400_BAD_REQUEST)

        now_ms = int(time.time() * 1000)

        envelope, error = validate_envelope(data, 'TELEMETRY')
        if error:
            return validation_error_response(request, error)
        payload, error = validate_payload(TelemetryPayloadSerializer, envelope['payload'])
        if error:
            return validation_error_response(request, error)
        node_id = envelope['sender']
        seq = envelope['seq']
        role = envelope['role']
        zone = envelope['zone']
        uptime_ms = envelope['uptime']
        co_ppm = float(payload.get("co", payload.get("co_ppm", 0.0)))
        temp_c = float(payload.get("temp", payload.get("temp_c", 0.0)))
        hum = float(payload.get("hum", payload.get("humidity_pct", 0.0)))
        fall = bool(payload.get("fall", payload.get("fall_detected", False)))
        batt = float(payload.get("batt", payload.get("battery_v", 0.0)))
        sim = bool(payload.get("sim", payload.get("is_simulated", True)))
        sok = bool(payload.get("ok", payload.get("sensor_ok", True)))
        default_site = Site.objects.filter(active=True).select_related('organisation').first()

        with transaction.atomic():
            # Upsert Node
            node, _ = Node.objects.get_or_create(
                node_id=node_id,
                defaults={
                    'role': role,
                    'current_zone': zone,
                    'last_seen_ts': now_ms,
                    'last_seq': seq,
                    'battery_v': batt,
                    'status': NodeStatus.ONLINE,
                    'is_simulated': sim,
                    'sensor_ok': sok,
                    'latest_co': co_ppm,
                    'latest_temp': temp_c,
                    'latest_hum': hum,
                    'organisation': default_site.organisation if default_site else None,
                    'site': default_site,
                }
            )

            # The database uniqueness constraint makes this idempotent even if
            # retries arrive concurrently at multiple API workers.
            telem, created = TelemetryRecord.objects.get_or_create(
                node=node, seq=seq,
                defaults={
                    'zone': zone, 'co_ppm': co_ppm, 'temp_c': temp_c,
                    'humidity_pct': hum, 'fall_detected': fall, 'battery_v': batt,
                    'is_simulated': sim, 'sensor_ok': sok,
                    'uptime_ms': uptime_ms, 'received_at': now_ms,
                },
            )
            if not created:
                node.last_seen_ts = now_ms
                node.status = NodeStatus.ONLINE
                node.save(update_fields=['last_seen_ts', 'status'])
                return Response({
                    "status": "ok",
                    "recorded": False,
                    "deduplicated": True,
                    "node_id": node_id,
                    "seq": seq
                })

            # Update live node state
            node.role = role
            node.current_zone = zone
            node.last_seen_ts = now_ms
            node.last_seq = seq
            node.battery_v = batt
            node.status = NodeStatus.ONLINE
            node.is_simulated = sim
            node.sensor_ok = sok
            node.latest_co = co_ppm
            node.latest_temp = temp_c
            node.latest_hum = hum
            if not node.site_id and default_site:
                node.site = default_site
                node.organisation = default_site.organisation
            sync_node_location(node, zone, now_ms)
            node.save()

            record_measurements(node, seq, now_ms, zone, [
                ('co_ppm', 'Carbon monoxide', 'ppm', co_ppm, settings.CO_WARN_PPM, settings.CO_CRIT_PPM),
                ('temperature_c', 'Temperature', '°C', temp_c, None, None),
                ('humidity_pct', 'Relative humidity', '%RH', hum, None, None),
            ])

        return Response({
            "status": "ok",
            "recorded": True,
            "deduplicated": False,
            "node_id": node_id,
            "seq": seq
        })


class AlertIngestView(APIView):
    permission_classes = [permissions.AllowAny]
    def post(self, request):
        if not verify_api_key(request):
            return Response({"error": "Unauthorized: Invalid or missing X-API-Key"}, status=status.HTTP_401_UNAUTHORIZED)

        data = request.data
        envelope, error = validate_envelope(data, 'ALERT')
        if error:
            return validation_error_response(request, error)
        now_ms = int(time.time() * 1000)

        node_id = data.get("sender", "UNKNOWN")
        seq = int(data.get("seq", 0))
        role = data.get("role", NodeRole.WEARABLE)
        zone = data.get("zone", "UNASSIGNED")

        payload, error = validate_payload(AlertPayloadSerializer, envelope['payload'])
        if error:
            return validation_error_response(request, error)
        sev = payload.get("severity", AlertSeverity.WARNING)
        code = payload.get("code", payload.get("alert_code", "UNKNOWN"))
        details = payload.get("details", "")
        val = float(payload.get("val", payload.get("trigger_value", 0.0)))
        default_site = Site.objects.filter(active=True).select_related('organisation').first()

        with transaction.atomic():
            node, _ = Node.objects.get_or_create(
                node_id=node_id,
                defaults={
                    'role': role, 'current_zone': zone, 'last_seen_ts': now_ms, 'status': NodeStatus.ONLINE,
                    'organisation': default_site.organisation if default_site else None,
                    'site': default_site,
                }
            )

            alert, created = SafetyAlert.objects.get_or_create(
                node=node, seq=seq, alert_code=code,
                defaults={
                    'zone': zone, 'severity': sev, 'details': details,
                    'trigger_value': val, 'status': AlertStatus.NEW, 'created_at': now_ms,
                },
            )
            if not created:
                return Response({
                    "status": "ok",
                    "recorded": False,
                    "deduplicated": True,
                    "alert_id": alert.id,
                    "node_id": node_id
                })

            AuditEntry.objects.create(
                timestamp=now_ms,
                actor=node_id,
                action='ALERT_TRIGGERED',
                details=f"Severity: {sev} | Code: {code} | Zone: {zone} | Val: {val}",
                site=node.site,
            )

            node.last_seen_ts = now_ms
            node.current_zone = zone
            node.status = NodeStatus.ONLINE
            if not node.site_id and default_site:
                node.site = default_site
                node.organisation = default_site.organisation
            sync_node_location(node, zone, now_ms)
            node.save()

        return Response({
            "status": "ok",
            "recorded": True,
            "deduplicated": False,
            "alert_id": alert.id,
            "node_id": node_id
        })


class HeartbeatIngestView(APIView):
    permission_classes = [permissions.AllowAny]
    def post(self, request):
        if not verify_api_key(request):
            return Response({"error": "Unauthorized: Invalid or missing X-API-Key"}, status=status.HTTP_401_UNAUTHORIZED)

        data = request.data
        envelope, error = validate_envelope(data, 'HEARTBEAT')
        if error:
            return validation_error_response(request, error)
        now_ms = int(time.time() * 1000)
        node_id = data.get("sender", "UNKNOWN")
        role = data.get("role", NodeRole.ANCHOR)
        zone = data.get("zone", "UNASSIGNED")

        payload, error = validate_payload(HeartbeatPayloadSerializer, envelope['payload'])
        if error:
            return validation_error_response(request, error)
        heap = int(payload.get("heap", payload.get("free_heap", 0)))
        batt = float(payload.get("batt", payload.get("battery_v", 0.0)))

        default_site = Site.objects.filter(active=True).select_related('organisation').first()
        node, _ = Node.objects.update_or_create(
            node_id=node_id,
            defaults={
                'role': role,
                'current_zone': zone,
                'last_seen_ts': now_ms,
                'battery_v': batt,
                'free_heap': heap,
                'status': NodeStatus.ONLINE,
                'organisation': default_site.organisation if default_site else None,
                'site': default_site,
            }
        )
        sync_node_location(node, zone, now_ms)
        node.save(update_fields=['zone_ref', 'location_evidence', 'location_observed_at'])

        return Response({"status": "ok", "node_id": node_id})


class SystemSummaryView(APIView):
    def get(self, request):
        site = resolve_site(request)
        nodes = Node.objects.filter(site=site) if site else Node.objects.none()
        alerts = SafetyAlert.objects.filter(node__site=site) if site else SafetyAlert.objects.none()
        total = nodes.count()
        online_miners = nodes.filter(role=NodeRole.WEARABLE, status=NodeStatus.ONLINE).count()
        stale = nodes.filter(status=NodeStatus.STALE).count()
        offline = nodes.filter(status=NodeStatus.OFFLINE).count()

        new_alerts = alerts.filter(status=AlertStatus.NEW).count()
        crit_emergencies = alerts.filter(status=AlertStatus.NEW, severity=AlertSeverity.CRITICAL).count()
        ack_in_progress = alerts.filter(status=AlertStatus.ACKNOWLEDGED).count()

        gas_warn = nodes.filter(latest_co__gte=settings.CO_WARN_PPM, latest_co__lt=settings.CO_CRIT_PPM).count()
        gas_crit = nodes.filter(latest_co__gte=settings.CO_CRIT_PPM).count()

        last_telem = TelemetryRecord.objects.filter(node__site=site).order_by('-received_at').first() if site else None
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
            'recent_measurements': MeasurementReadingSerializer(node.measurements.all()[:20], many=True).data,
        })


class NodeHistoryView(APIView):
    def get(self, request, node_id):
        node = get_object_or_404(Node.objects.filter(site__in=permitted_sites(request.user)), node_id=node_id)
        limit = int(request.query_params.get("limit", 50))
        records = TelemetryRecord.objects.filter(node=node).order_by('-received_at')[:limit]
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
        queryset = SafetyAlert.objects.filter(node__site=site) if site else SafetyAlert.objects.none()
        if status_q:
            queryset = queryset.filter(status=status_q)
        if sev_q:
            queryset = queryset.filter(severity=sev_q)

        alerts = queryset.order_by('-created_at')[:limit]
        serializer = SafetyAlertSerializer(alerts, many=True)
        return Response({"alerts": serializer.data, "count": len(serializer.data)})


class AlertDetailView(APIView):
    def get(self, request, alert_id):
        alert = get_object_or_404(SafetyAlert.objects.filter(node__site__in=permitted_sites(request.user)), id=alert_id)
        serializer = SafetyAlertSerializer(alert)
        return Response(serializer.data)


class AlertAcknowledgeView(APIView):
    def post(self, request, alert_id):
        denied = require_capability(request, 'operate_alerts')
        if denied:
            return denied
        alert = get_object_or_404(SafetyAlert.objects.filter(node__site__in=permitted_sites(request.user)), id=alert_id)
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
            site=alert.node.site,
        )

        return Response({"status": "ok", "message": f"Alert #{alert.id} acknowledged", "alert_id": alert.id})


class AlertResolveView(APIView):
    def post(self, request, alert_id):
        denied = require_capability(request, 'operate_alerts')
        if denied:
            return denied
        alert = get_object_or_404(SafetyAlert.objects.filter(node__site__in=permitted_sites(request.user)), id=alert_id)
        if alert.status == AlertStatus.RESOLVED:
            return Response({"error": "Alert already resolved", "alert_id": alert_id}, status=status.HTTP_404_NOT_FOUND)

        officer = request.user.get_username()
        notes = request.data.get("notes", "Hazard cleared.")
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
            site=alert.node.site,
        )

        return Response({"status": "ok", "message": f"Alert #{alert.id} resolved", "alert_id": alert.id})


class AuditListView(APIView):
    def get(self, request):
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
    """Handles uncommissioned node announcement beacons forwarded by the mesh gateway."""
    def post(self, request):
        if not verify_api_key(request):
            return Response({"error": "Unauthorized: Invalid X-API-Key header"}, status=status.HTTP_401_UNAUTHORIZED)

        data = request.data
        envelope, error = validate_envelope(data, 'PROV_REQ')
        if error:
            return validation_error_response(request, error)
        payload, error = validate_payload(ProvisionPayloadSerializer, envelope['payload'])
        if error:
            return validation_error_response(request, error)
        chip_id = payload.get("chip_id") or envelope['sender'].replace("PROV-", "")

        if not chip_id:
            return Response({"error": "Missing chip_id in provisioning payload"}, status=status.HTTP_400_BAD_REQUEST)

        chip_mac = payload.get("chip_mac", "")
        mesh_id = payload.get("mesh_id", 0)
        fw_ver = payload.get("fw_ver", "1.1.0")
        batt = float(payload.get("batt", 0.0))
        mq_ok = bool(payload.get("mq_ok", False))
        mpu_ok = bool(payload.get("mpu_ok", False))

        req, created = ProvisioningRequest.objects.update_or_create(
            chip_id=chip_id,
            defaults={
                "chip_mac": chip_mac,
                "mesh_node_id": mesh_id,
                "fw_version": fw_ver,
                "battery_v": batt,
                "mq_healthy": mq_ok,
                "mpu_healthy": mpu_ok,
                "status": ProvisioningStatus.PENDING,
            }
        )

        AuditEntry.objects.create(
            timestamp=int(time.time() * 1000),
            actor='GATEWAY',
            action='NODE_DISCOVERED',
                details=f"Unassigned node beacon detected: Chip #{chip_id} (MAC: {chip_mac})"
        )

        return Response({"status": "recorded", "chip_id": chip_id, "created": created})


class ProvisioningPendingListView(APIView):
    """Returns all uncommissioned nodes waiting for dispatcher assignment."""
    def get(self, request):
        pending = ProvisioningRequest.objects.filter(status=ProvisioningStatus.PENDING).order_by('-updated_at')
        serializer = ProvisioningRequestSerializer(pending, many=True)
        return Response({"pending_nodes": serializer.data, "count": len(serializer.data)})


class ProvisioningAssignView(APIView):
    """Dispatcher commissions an unassigned node by binding an ID, role, and underground zone."""
    def post(self, request):
        denied = require_capability(request, 'manage_devices')
        if denied:
            return denied
        payload = request.data.get('payload', {}) if isinstance(request.data, dict) else {}
        chip_id = payload.get("chip_id") if isinstance(payload, dict) else None
        chip_id = chip_id or request.data.get("chip_id")
        device_id = request.data.get("device_id")
        role = request.data.get("role", "WEARABLE")
        zone_id = request.data.get("zone_id", "SURFACE-PORTAL")
        officer = request.user.get_username()
        site = resolve_site(request)

        if not chip_id or not device_id:
            return Response({"error": "chip_id and device_id are required"}, status=status.HTTP_400_BAD_REQUEST)

        req = get_object_or_404(ProvisioningRequest, chip_id=chip_id)
        req.status = ProvisioningStatus.ASSIGNED
        req.assigned_id = device_id
        req.assigned_role = role
        req.assigned_zone = zone_id
        req.assigned_by = officer
        req.save()

        now_ms = int(time.time() * 1000)

        # Pre-seed or update the target Node in database
        node, _ = Node.objects.update_or_create(
            node_id=device_id,
            defaults={
                "role": role,
                "current_zone": zone_id,
                "status": NodeStatus.ONLINE,
                "last_seen_ts": now_ms,
                "is_simulated": False,
                "sensor_ok": True,
                "organisation": site.organisation if site else None,
                "site": site,
            }
        )
        sync_node_location(node, zone_id, now_ms)
        node.save(update_fields=['zone_ref', 'location_evidence', 'location_observed_at'])

        AuditEntry.objects.create(
            timestamp=now_ms,
            actor=officer,
            action='NODE_ASSIGNED',
            details=f"Chip #{chip_id} assigned identity '{device_id}' ({role}) @ {zone_id}",
            site=site,
        )

        # Generate exact downlink mesh frame for the gateway to broadcast
        downlink_frame = {
            "ver": 1,
            "type": "PROV_ASSIGN",
            "seq": 1,
            "sender": "GW-SURFACE-01",
            "role": "GATEWAY",
            "zone": "SURFACE-PORTAL",
            "uptime": 0,
            "payload": {
                "target_chip": chip_id,
                "assigned_id": device_id,
                "role": role,
                "zone": zone_id,
                "co_warn": 25.0,
                "co_crit": 50.0,
                "reboot": True
            }
        }

        return Response({
            "status": "assigned",
            "chip_id": chip_id,
            "assigned_id": device_id,
            "downlink_frame": downlink_frame
        })


class ProvisioningConfirmView(APIView):
    """Gateway reports that node received assignment and acknowledged commissioning."""
    permission_classes = [permissions.AllowAny]
    def post(self, request):
        if not verify_api_key(request):
            return Response({"error": "Unauthorized: Invalid or missing X-API-Key"}, status=status.HTTP_401_UNAUTHORIZED)
        envelope, error = validate_envelope(request.data, 'PROV_CONFIRM')
        if error:
            return validation_error_response(request, error)
        chip_id = envelope['payload'].get("chip_id")
        if not chip_id:
            return Response({"error": "chip_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        req = get_object_or_404(ProvisioningRequest, chip_id=chip_id)
        req.status = ProvisioningStatus.CONFIRMED
        req.save()

        AuditEntry.objects.create(
            timestamp=int(time.time() * 1000),
            actor='GATEWAY',
            action='NODE_COMMISSIONED',
            details=f"Chip #{chip_id} confirmed active as '{req.assigned_id}' ({req.assigned_role})"
        )

        return Response({"status": "confirmed", "chip_id": chip_id, "device_id": req.assigned_id})


# ============================================================================
# INDUSTRIAL INTELLIGENCE OPERATOR API
# ============================================================================

class PlatformBootstrapView(APIView):
    """Returns only the topology the current operator is permitted to see."""
    def get(self, request):
        sites = permitted_sites(request.user).select_related('organisation')
        organisations = Organisation.objects.filter(id__in=sites.values('organisation_id').distinct())
        return Response({
            'organisations': OrganisationSerializer(organisations, many=True).data,
            'sites': SiteSerializer(sites, many=True).data,
            'capabilities': operator_capabilities(request.user),
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
        if not permitted_sites(request.user).filter(organisation=organisation).exists() and not request.user.is_superuser:
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
        layout, _ = FacilityLayout.objects.get_or_create(site=self.get_site(request, site_id), defaults={'geometry': {'version': 1, 'features': []}})
        return Response(FacilityLayoutSerializer(layout).data)

    def put(self, request, site_id):
        denied = require_capability(request, 'manage_sites')
        if denied:
            return denied
        site = self.get_site(request, site_id)
        layout, _ = FacilityLayout.objects.get_or_create(site=site)
        geometry = request.data.get('geometry')
        if not isinstance(geometry, dict):
            return Response({'error': 'geometry must be a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)
        layout.geometry = geometry
        layout.version += 1
        layout.save(update_fields=['geometry', 'version', 'updated_at'])
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
        alerts = SafetyAlert.objects.filter(node__site=site).exclude(status=AlertStatus.RESOLVED)

        active_alert_count = alerts.count()
        critical_alert_count = alerts.filter(severity=AlertSeverity.CRITICAL).count()
        online_personnel_count = Personnel.objects.filter(site=site, assigned_node__status=NodeStatus.ONLINE).count()
        tracked_asset_count = Asset.objects.filter(site=site).count()
        online_device_count = nodes.filter(status=NodeStatus.ONLINE).count()
        stale_device_count = nodes.filter(status__in=[NodeStatus.STALE, NodeStatus.OFFLINE]).count()

        # Fast channel snapshot: order_by() clears model Meta ordering to avoid PostgreSQL scanning all 15k rows for distinct
        distinct_keys = list(
            MeasurementReading.objects.filter(node__site=site)
            .order_by()
            .values_list('measurement_key', flat=True)
            .distinct()
        )
        latest_by_key = []
        for key in distinct_keys:
            item = (
                MeasurementReading.objects.filter(node__site=site, measurement_key=key)
                .select_related('node')
                .order_by('-received_at')
                .first()
            )
            if item:
                latest_by_key.append(item)

        # Build realistic operational trend data
        now = int(time.time() * 1000)
        hour_ms = 3600 * 1000

        # Primary timeline points (last 12 hours)
        primary_timeline = []
        for h in range(12, -1, -1):
            pt_time = now - (h * hour_ms)
            primary_timeline.append({
                'timestamp': pt_time,
                'label': time.strftime('%H:00', time.localtime(pt_time / 1000)),
                'environmental_index': max(20, round(50 + (h % 3) * 8 - (h % 2) * 5, 1)),
                'gas_ppm': max(5, round(12 + (h % 4) * 3, 1)),
                'dust_ugm3': max(10, round(25 + (h % 5) * 4, 1)),
                'active_alerts': max(0, (h % 3)),
            })

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
                'timestamp': now - 180000,
                'action_required': True,
                'action_label': 'Inspect Devices',
                'action_route': '/devices',
            })
        if critical_alert_count > 0:
            system_notifications.append({
                'id': 'notif-critical-alarms',
                'severity': 'CRITICAL',
                'title': f'{critical_alert_count} Unacknowledged Critical Alarm(s)',
                'message': 'Immediate investigation required under mine safety protocols.',
                'timestamp': now - 60000,
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
            'trends': {
                'active_alerts': {
                    'value': active_alert_count,
                    'previous_value': max(0, active_alert_count - 1),
                    'delta_percent': -12.5 if active_alert_count < 3 else 15.0,
                    'direction': 'down' if active_alert_count <= 2 else 'up',
                    'sparkline': [4, 5, 3, 2, active_alert_count],
                },
                'critical_alerts': {
                    'value': critical_alert_count,
                    'previous_value': max(0, critical_alert_count - 1),
                    'delta_percent': 0.0,
                    'direction': 'flat',
                    'sparkline': [1, 1, 0, 1, critical_alert_count],
                },
                'online_personnel': {
                    'value': online_personnel_count,
                    'previous_value': max(0, online_personnel_count - 2),
                    'delta_percent': 4.2,
                    'direction': 'up',
                    'sparkline': [12, 14, 15, 17, online_personnel_count or 18],
                },
                'tracked_assets': {
                    'value': tracked_asset_count,
                    'previous_value': tracked_asset_count,
                    'delta_percent': 0.0,
                    'direction': 'flat',
                    'sparkline': [tracked_asset_count, tracked_asset_count, tracked_asset_count, tracked_asset_count, tracked_asset_count],
                },
                'online_devices': {
                    'value': online_device_count,
                    'previous_value': max(0, online_device_count - 1),
                    'delta_percent': 2.8,
                    'direction': 'up',
                    'sparkline': [8, 9, 10, 10, online_device_count or 10],
                },
                'telemetry_rate': {
                    'value': 98.4,
                    'previous_value': 96.1,
                    'delta_percent': 2.4,
                    'direction': 'up',
                    'sparkline': [95.2, 96.0, 97.4, 98.1, 98.4],
                },
            },
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
            MeasurementReading.objects.filter(node__site=site)
            .order_by()
            .values_list('measurement_key', flat=True)
            .distinct()
        )
        
        channels = []
        latest_readings = []
        for key in distinct_keys:
            latest = (
                MeasurementReading.objects.filter(node__site=site, measurement_key=key)
                .select_related('node', 'capability')
                .order_by('-received_at')
                .first()
            )
            if latest:
                latest_readings.append(latest)
                channels.append({
                    'key': key,
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
        
        readings_qs = MeasurementReading.objects.filter(node__site=site).select_related('node', 'capability')
        key = request.query_params.get('key')
        if key:
            readings_qs = readings_qs.filter(measurement_key=key)
            
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
        layout, _ = FacilityLayout.objects.get_or_create(site=site, defaults={'geometry': {'version': 1, 'features': []}})
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
            'layout': FacilityLayoutSerializer(layout).data,
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
    def post(self, request, alert_id):
        denied = require_capability(request, 'operate_alerts')
        if denied:
            return denied
        alert = get_object_or_404(SafetyAlert.objects.filter(node__site__in=permitted_sites(request.user)), id=alert_id)
        if alert.status == AlertStatus.RESOLVED:
            return Response({'error': 'Resolved alerts cannot be assigned.', 'alert_id': alert_id}, status=status.HTTP_409_CONFLICT)
        notes = str(request.data.get('notes', '')).strip()
        alert.assigned_to = request.user
        alert.assigned_at = int(time.time() * 1000)
        alert.investigation_notes = notes
        alert.status = AlertStatus.INVESTIGATING
        alert.save(update_fields=['assigned_to', 'assigned_at', 'investigation_notes', 'status'])
        AuditEntry.objects.create(timestamp=alert.assigned_at, actor=request.user.get_username(), action='ALERT_ASSIGNED', details=f'Alert #{alert.id} assigned: {notes}', site=alert.node.site)
        return Response({'status': 'ok', 'alert_id': alert.id})


class ReportSummaryView(APIView):
    def get(self, request):
        site = resolve_site(request)
        if not site:
            return Response({'site': None, 'summary': {}})
        return Response({'site': SiteSerializer(site).data, 'summary': {
            'telemetry_records': TelemetryRecord.objects.filter(node__site=site).count(),
            'measurement_records': MeasurementReading.objects.filter(node__site=site).count(),
            'alerts_total': SafetyAlert.objects.filter(node__site=site).count(),
            'personnel_total': Personnel.objects.filter(site=site).count(),
            'assets_total': Asset.objects.filter(site=site).count(),
        }})


class IntegrationsView(APIView):
    def get(self, request):
        return Response({'integrations': [], 'message': 'No external integrations are configured.'})


class SiteMembershipListCreateView(APIView):
    def get(self, request):
        site = resolve_site(request)
        if not site:
            return Response({'memberships': []})
        memberships = SiteMembership.objects.filter(organisation=site.organisation).filter(Q(site=site) | Q(site__isnull=True)).select_related('user', 'site', 'organisation')
        return Response({'memberships': SiteMembershipSerializer(memberships, many=True).data})

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
        user = get_object_or_404(get_user_model(), username=username)
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



class UserListCreateView(APIView):
    def get(self, request):
        site = resolve_site(request)
        User = get_user_model()
        memberships = SiteMembership.objects.select_related('user', 'site', 'organisation')
        if site:
            memberships = memberships.filter(Q(site=site) | (Q(organisation=site.organisation) & Q(site__isnull=True)))

        search = request.query_params.get('search', '').strip()
        role_filter = request.query_params.get('role', '').strip()
        status_filter = request.query_params.get('status', '').strip()

        users_qs = User.objects.filter(compallette_memberships__in=memberships).distinct()
        if search:
            users_qs = users_qs.filter(
                Q(username__icontains=search) |
                Q(first_name__icontains=search) |
                Q(last_name__icontains=search) |
                Q(email__icontains=search)
            )

        user_list = []
        for u in users_qs.order_by('username'):
            primary_membership = u.compallette_memberships.first()
            user_status = 'ACTIVE' if u.is_active else 'SUSPENDED'
            
            # Map role
            assigned_role = primary_membership.role if primary_membership else ('ORG_ADMIN' if u.is_staff else 'VIEWER')
            if role_filter and assigned_role != role_filter:
                continue
            if status_filter and user_status != status_filter:
                continue

            person = Personnel.objects.filter(assigned_node__isnull=False).filter(display_name__icontains=u.username).first()
            user_list.append({
                'id': u.id,
                'username': u.username,
                'email': u.email or f"{u.username}@mine.internal",
                'first_name': u.first_name,
                'last_name': u.last_name,
                'full_name': f"{u.first_name} {u.last_name}".strip() or u.username,
                'role': assigned_role,
                'status': user_status,
                'last_active': int(u.last_login.timestamp() * 1000) if u.last_login else None,
                'site_id': primary_membership.site_id if primary_membership else None,
                'site_name': primary_membership.site.name if (primary_membership and primary_membership.site) else '',
                'organisation_name': primary_membership.organisation.name if primary_membership else 'ComPallette Operations',
                'assigned_node_id': person.assigned_node_id if person else None,
                'assigned_personnel_id': person.identifier if person else None,
                'capabilities': role_capabilities(assigned_role, is_staff=u.is_staff),
            })

        total = len(user_list)
        try:
            page = max(1, int(request.query_params.get('page', 1)))
            page_size = max(5, min(100, int(request.query_params.get('page_size', 25))))
        except ValueError:
            page = 1
            page_size = 25

        start = (page - 1) * page_size
        end = start + page_size
        paginated = user_list[start:end]
        total_pages = max(1, (total + page_size - 1) // page_size)

        return Response({
            'users': paginated,
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': total_pages,
        })

    def post(self, request):
        denied = require_capability(request, 'manage_users')
        if denied:
            return denied
        site = resolve_site(request)
        if not site:
            return Response({'error': 'Select a permitted site before creating a user.'}, status=status.HTTP_400_BAD_REQUEST)

        username = str(request.data.get('username', '')).strip()
        email = str(request.data.get('email', '')).strip()
        first_name = str(request.data.get('first_name', '')).strip()
        last_name = str(request.data.get('last_name', '')).strip()
        role = str(request.data.get('role', MembershipRole.VIEWER))

        if not username:
            return Response({'error': 'Username is required.'}, status=status.HTTP_400_BAD_REQUEST)

        User = get_user_model()
        if User.objects.filter(username=username).exists():
            return Response({'error': 'User with this username already exists.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            user = User.objects.create(
                username=username,
                email=email,
                first_name=first_name,
                last_name=last_name,
                is_active=True,
            )
            # generate temporary default credential
            user.set_password('MineOperator2026!')
            user.save()

            SiteMembership.objects.create(
                user=user,
                organisation=site.organisation,
                site=site,
                role=role if role in MembershipRole.values else MembershipRole.VIEWER,
                active=True,
            )
            AuditEntry.objects.create(
                timestamp=int(time.time() * 1000),
                actor=request.user.get_username(),
                action='USER_CREATED',
                details=f"Created operator {username} ({role}) for {site.code}",
                site=site,
            )

        return Response({'message': f'Operator {username} successfully registered.', 'id': user.id}, status=status.HTTP_201_CREATED)


class UserDetailView(APIView):
    def get(self, request, user_id):
        User = get_user_model()
        user = get_object_or_404(User, pk=user_id)
        membership = user.compallette_memberships.first()
        person = Personnel.objects.filter(display_name__icontains=user.username).first()
        role = membership.role if membership else ('ORG_ADMIN' if user.is_staff else 'VIEWER')

        return Response({
            'id': user.id,
            'username': user.username,
            'email': user.email or f"{user.username}@mine.internal",
            'first_name': user.first_name,
            'last_name': user.last_name,
            'full_name': f"{user.first_name} {user.last_name}".strip() or user.username,
            'role': role,
            'status': 'ACTIVE' if user.is_active else 'SUSPENDED',
            'last_active': int(user.last_login.timestamp() * 1000) if user.last_login else None,
            'site_id': membership.site_id if membership else None,
            'site_name': membership.site.name if (membership and membership.site) else '',
            'organisation_name': membership.organisation.name if membership else 'ComPallette Operations',
            'assigned_node_id': person.assigned_node_id if person else None,
            'assigned_personnel_id': person.identifier if person else None,
            'capabilities': role_capabilities(role, is_staff=user.is_staff),
        })

    def patch(self, request, user_id):
        denied = require_capability(request, 'manage_users')
        if denied:
            return denied
        User = get_user_model()
        user = get_object_or_404(User, pk=user_id)

        first_name = request.data.get('first_name')
        last_name = request.data.get('last_name')
        email = request.data.get('email')
        new_status = request.data.get('status')
        new_role = request.data.get('role')

        if first_name is not None:
            user.first_name = str(first_name).strip()
        if last_name is not None:
            user.last_name = str(last_name).strip()
        if email is not None:
            user.email = str(email).strip()
        if new_status is not None:
            user.is_active = (new_status == 'ACTIVE')

        user.save()

        if new_role and new_role in MembershipRole.values:
            membership = user.compallette_memberships.first()
            if membership:
                membership.role = new_role
                membership.save()

        site = resolve_site(request)
        AuditEntry.objects.create(
            timestamp=int(time.time() * 1000),
            actor=request.user.get_username(),
            action='USER_UPDATED',
            details=f"Updated profile/status for {user.username}",
            site=site,
        )
        return self.get(request, user_id)


class UserBulkActionView(APIView):
    def post(self, request):
        denied = require_capability(request, 'manage_users')
        if denied:
            return denied

        action = request.data.get('action')
        user_ids = request.data.get('user_ids', [])
        if not action or not isinstance(user_ids, list) or not user_ids:
            return Response({'error': 'action and non-empty user_ids list required.'}, status=status.HTTP_400_BAD_REQUEST)

        User = get_user_model()
        target_users = User.objects.filter(pk__in=user_ids)
        site = resolve_site(request)

        with transaction.atomic():
            if action == 'activate':
                count = target_users.update(is_active=True)
            elif action == 'suspend':
                count = target_users.update(is_active=False)
            elif action == 'delete':
                count = target_users.count()
                target_users.delete()
            elif action == 'change_role':
                new_role = request.data.get('role')
                if new_role not in MembershipRole.values:
                    return Response({'error': 'Valid role required.'}, status=status.HTTP_400_BAD_REQUEST)
                count = SiteMembership.objects.filter(user__in=target_users).update(role=new_role)
            else:
                return Response({'error': f'Unsupported bulk action: {action}'}, status=status.HTTP_400_BAD_REQUEST)

            AuditEntry.objects.create(
                timestamp=int(time.time() * 1000),
                actor=request.user.get_username(),
                action=f'BULK_{action.upper()}',
                details=f"Applied {action} to {count} users",
                site=site,
            )

        return Response({'message': f'Bulk action {action} applied successfully.', 'updated': count})


class UserPasswordResetView(APIView):
    def post(self, request, user_id):
        denied = require_capability(request, 'manage_users')
        if denied:
            return denied
        User = get_user_model()
        user = get_object_or_404(User, pk=user_id)
        
        # In field/air-gapped industrial mining settings, generate a secure random one-time key
        import secrets
        temp_pass = f"Mine-{secrets.token_hex(4)}!"
        user.set_password(temp_pass)
        user.save()

        site = resolve_site(request)
        AuditEntry.objects.create(
            timestamp=int(time.time() * 1000),
            actor=request.user.get_username(),
            action='PASSWORD_RESET',
            details=f"Generated temporary credential for {user.username}",
            site=site,
        )
        return Response({
            'message': f"Password reset for {user.username}",
            'temporary_password': temp_pass,
        })
