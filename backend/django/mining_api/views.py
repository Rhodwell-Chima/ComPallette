import logging
import time
from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.db import transaction, IntegrityError
from django.shortcuts import get_object_or_404
from rest_framework import status, permissions
from rest_framework.views import APIView
from rest_framework.response import Response

from .models import (
    Node, NodeRole, NodeStatus, TelemetryRecord, SafetyAlert, AlertSeverity,
    AlertStatus, AuditEntry, ProvisioningRequest, ProvisioningStatus
)
from .serializers import (
    NodeSerializer, TelemetryRecordSerializer, SafetyAlertSerializer,
    AuditEntrySerializer, ProvisioningRequestSerializer
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
        login(request, user)
        return Response({"authenticated": True, "username": user.get_username(), "is_staff": user.is_staff})

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"authenticated": False}, status=status.HTTP_401_UNAUTHORIZED)
        return Response({"authenticated": True, "username": request.user.get_username(), "is_staff": request.user.is_staff})

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
                details=f"Node {n.node_id} marked OFFLINE in {n.current_zone}"
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
            node.save()

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

        with transaction.atomic():
            node, _ = Node.objects.get_or_create(
                node_id=node_id,
                defaults={'role': role, 'current_zone': zone, 'last_seen_ts': now_ms, 'status': NodeStatus.ONLINE}
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
                details=f"Severity: {sev} | Code: {code} | Zone: {zone} | Val: {val}"
            )

            node.last_seen_ts = now_ms
            node.current_zone = zone
            node.status = NodeStatus.ONLINE
            node.save(update_fields=['last_seen_ts', 'current_zone', 'status'])

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

        Node.objects.update_or_create(
            node_id=node_id,
            defaults={
                'role': role,
                'current_zone': zone,
                'last_seen_ts': now_ms,
                'battery_v': batt,
                'free_heap': heap,
                'status': NodeStatus.ONLINE
            }
        )

        return Response({"status": "ok", "node_id": node_id})


class SystemSummaryView(APIView):
    def get(self, request):
        total = Node.objects.count()
        online_miners = Node.objects.filter(role=NodeRole.WEARABLE, status=NodeStatus.ONLINE).count()
        stale = Node.objects.filter(status=NodeStatus.STALE).count()
        offline = Node.objects.filter(status=NodeStatus.OFFLINE).count()

        new_alerts = SafetyAlert.objects.filter(status=AlertStatus.NEW).count()
        crit_emergencies = SafetyAlert.objects.filter(status=AlertStatus.NEW, severity=AlertSeverity.CRITICAL).count()
        ack_in_progress = SafetyAlert.objects.filter(status=AlertStatus.ACKNOWLEDGED).count()

        gas_warn = Node.objects.filter(latest_co__gte=settings.CO_WARN_PPM, latest_co__lt=settings.CO_CRIT_PPM).count()
        gas_crit = Node.objects.filter(latest_co__gte=settings.CO_CRIT_PPM).count()

        last_telem = TelemetryRecord.objects.order_by('-received_at').first()
        last_node = Node.objects.order_by('-last_seen_ts').first()
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

        queryset = Node.objects.all().order_by('node_id')

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
        node = get_object_or_404(Node, node_id=node_id)
        serializer = NodeSerializer(node)
        return Response(serializer.data)


class NodeHistoryView(APIView):
    def get(self, request, node_id):
        node = get_object_or_404(Node, node_id=node_id)
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

        queryset = SafetyAlert.objects.all()
        if status_q:
            queryset = queryset.filter(status=status_q)
        if sev_q:
            queryset = queryset.filter(severity=sev_q)

        alerts = queryset.order_by('-created_at')[:limit]
        serializer = SafetyAlertSerializer(alerts, many=True)
        return Response({"alerts": serializer.data, "count": len(serializer.data)})


class AlertDetailView(APIView):
    def get(self, request, alert_id):
        alert = get_object_or_404(SafetyAlert, id=alert_id)
        serializer = SafetyAlertSerializer(alert)
        return Response(serializer.data)


class AlertAcknowledgeView(APIView):
    permission_classes = [permissions.IsAdminUser]
    def post(self, request, alert_id):
        alert = get_object_or_404(SafetyAlert, id=alert_id)
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
            details=f"Alert #{alert.id} acknowledged by {officer}"
        )

        return Response({"status": "ok", "message": f"Alert #{alert.id} acknowledged", "alert_id": alert.id})


class AlertResolveView(APIView):
    permission_classes = [permissions.IsAdminUser]
    def post(self, request, alert_id):
        alert = get_object_or_404(SafetyAlert, id=alert_id)
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
            details=f"Alert #{alert.id} resolved: {notes}"
        )

        return Response({"status": "ok", "message": f"Alert #{alert.id} resolved", "alert_id": alert.id})


class AuditListView(APIView):
    def get(self, request):
        limit = int(request.query_params.get("limit", 100))
        entries = AuditEntry.objects.all().order_by('-timestamp')[:limit]
        serializer = AuditEntrySerializer(entries, many=True)
        return Response({"audit_log": serializer.data, "count": len(serializer.data)})


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
    permission_classes = [permissions.IsAdminUser]
    """Dispatcher commissions an unassigned node by binding an ID, role, and underground zone."""
    def post(self, request):
        payload = request.data.get('payload', {}) if isinstance(request.data, dict) else {}
        chip_id = payload.get("chip_id") if isinstance(payload, dict) else None
        chip_id = chip_id or request.data.get("chip_id")
        device_id = request.data.get("device_id")
        role = request.data.get("role", "WEARABLE")
        zone_id = request.data.get("zone_id", "SURFACE-PORTAL")
        officer = request.user.get_username()

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
        Node.objects.update_or_create(
            node_id=device_id,
            defaults={
                "role": role,
                "current_zone": zone_id,
                "status": NodeStatus.ONLINE,
                "last_seen_ts": now_ms,
                "is_simulated": False,
                "sensor_ok": True,
            }
        )

        AuditEntry.objects.create(
            timestamp=now_ms,
            actor=officer,
            action='NODE_ASSIGNED',
            details=f"Chip #{chip_id} assigned identity '{device_id}' ({role}) @ {zone_id}"
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
