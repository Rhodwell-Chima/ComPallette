import time
from django.conf import settings
from django.db import transaction, IntegrityError
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response

from .models import Node, NodeRole, NodeStatus, TelemetryRecord, SafetyAlert, AlertSeverity, AlertStatus, AuditEntry
from .serializers import NodeSerializer, TelemetryRecordSerializer, SafetyAlertSerializer, AuditEntrySerializer


def verify_api_key(request):
    """Verifies gateway X-API-Key header matches configured secret."""
    key = request.headers.get('X-API-Key')
    return key == settings.COMPALLETTE_API_KEY


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
    dropping = Node.objects.filter(
        last_seen_ts__lt=offline_limit
    ).exclude(status=NodeStatus.OFFLINE)

    for n in dropping:
        n.status = NodeStatus.OFFLINE
        n.save(update_fields=['status'])

        # Create automated COMM_LOST safety alert
        SafetyAlert.objects.get_or_create(
            node=n,
            seq=0,
            alert_code='COMM_LOST',
            defaults={
                'zone': n.current_zone,
                'severity': AlertSeverity.WARNING,
                'details': f"Node {n.node_id} ({n.role}) lost underground communication in {n.current_zone}",
                'trigger_value': 0.0,
                'status': AlertStatus.NEW,
                'created_at': now_ms,
            }
        )
        AuditEntry.objects.create(
            timestamp=now_ms,
            actor='SYSTEM_WATCHDOG',
            action='COMM_LOST',
            details=f"Node {n.node_id} marked OFFLINE in {n.current_zone}"
        )


class HealthCheckView(APIView):
    def get(self, request):
        return Response({
            "status": "healthy",
            "service": "Compallette Mining Safety Django Backend",
            "version": "2.0.0",
            "database": settings.DATABASES['default']['ENGINE'].split('.')[-1],
        })


class TelemetryIngestView(APIView):
    def post(self, request):
        if not verify_api_key(request):
            return Response({"error": "Unauthorized: Invalid or missing X-API-Key"}, status=status.HTTP_401_UNAUTHORIZED)

        data = request.data
        if not isinstance(data, dict):
            return Response({"error": "Malformed JSON payload"}, status=status.HTTP_400_BAD_REQUEST)

        now_ms = int(time.time() * 1000)

        # Legacy payload support
        is_legacy = ("ver" not in data and "miner_id" in data)
        if is_legacy:
            node_id = data.get("miner_id", "LEGACY_NODE")
            seq = 0
            role = NodeRole.WEARABLE
            zone = "UNASSIGNED"
            uptime_ms = 0
            co_ppm = float(data.get("co", 0.0))
            fall = bool(data.get("fall", False))
            temp_c, hum, batt, sim, sok = 0.0, 0.0, 0.0, True, True
        else:
            node_id = data.get("sender", "UNKNOWN")
            seq = int(data.get("seq", 0))
            role = data.get("role", NodeRole.WEARABLE)
            zone = data.get("zone", "UNASSIGNED")
            uptime_ms = int(data.get("uptime", 0))

            payload = data.get("payload", {})
            if not isinstance(payload, dict):
                return Response({"error": "Missing or invalid payload object"}, status=status.HTTP_400_BAD_REQUEST)

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

            # Check sequence deduplication
            existing_telem = TelemetryRecord.objects.filter(node=node, seq=seq).exists()
            if existing_telem:
                return Response({
                    "status": "ok",
                    "recorded": False,
                    "deduplicated": True,
                    "node_id": node_id,
                    "seq": seq
                })

            # Record new telemetry
            TelemetryRecord.objects.create(
                node=node,
                seq=seq,
                zone=zone,
                co_ppm=co_ppm,
                temp_c=temp_c,
                humidity_pct=hum,
                fall_detected=fall,
                battery_v=batt,
                is_simulated=sim,
                sensor_ok=sok,
                uptime_ms=uptime_ms,
                received_at=now_ms
            )

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
    def post(self, request):
        if not verify_api_key(request):
            return Response({"error": "Unauthorized: Invalid or missing X-API-Key"}, status=status.HTTP_401_UNAUTHORIZED)

        data = request.data
        now_ms = int(time.time() * 1000)

        node_id = data.get("sender", "UNKNOWN")
        seq = int(data.get("seq", 0))
        role = data.get("role", NodeRole.WEARABLE)
        zone = data.get("zone", "UNASSIGNED")

        payload = data.get("payload", {})
        sev = payload.get("severity", AlertSeverity.WARNING)
        code = payload.get("code", payload.get("alert_code", "UNKNOWN"))
        details = payload.get("details", "")
        val = float(payload.get("val", payload.get("trigger_value", 0.0)))

        with transaction.atomic():
            node, _ = Node.objects.get_or_create(
                node_id=node_id,
                defaults={'role': role, 'current_zone': zone, 'last_seen_ts': now_ms, 'status': NodeStatus.ONLINE}
            )

            existing = SafetyAlert.objects.filter(node=node, seq=seq, alert_code=code).first()
            if existing:
                return Response({
                    "status": "ok",
                    "recorded": False,
                    "deduplicated": True,
                    "alert_id": existing.id,
                    "node_id": node_id
                })

            alert = SafetyAlert.objects.create(
                node=node,
                zone=zone,
                severity=sev,
                alert_code=code,
                details=details,
                trigger_value=val,
                status=AlertStatus.NEW,
                seq=seq,
                created_at=now_ms
            )

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
    def post(self, request):
        if not verify_api_key(request):
            return Response({"error": "Unauthorized: Invalid or missing X-API-Key"}, status=status.HTTP_401_UNAUTHORIZED)

        data = request.data
        now_ms = int(time.time() * 1000)
        node_id = data.get("sender", "UNKNOWN")
        role = data.get("role", NodeRole.ANCHOR)
        zone = data.get("zone", "UNASSIGNED")

        payload = data.get("payload", {})
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
        check_and_update_watchdog()

        total = Node.objects.count()
        online_miners = Node.objects.filter(role=NodeRole.WEARABLE, status=NodeStatus.ONLINE).count()
        stale = Node.objects.filter(status=NodeStatus.STALE).count()
        offline = Node.objects.filter(status=NodeStatus.OFFLINE).count()

        new_alerts = SafetyAlert.objects.filter(status=AlertStatus.NEW).count()
        crit_emergencies = SafetyAlert.objects.filter(status=AlertStatus.NEW, severity=AlertSeverity.CRITICAL).count()
        ack_in_progress = SafetyAlert.objects.filter(status=AlertStatus.ACKNOWLEDGED).count()

        gas_warn = Node.objects.filter(latest_co__gte=settings.CO_WARN_PPM, latest_co__lt=settings.CO_CRIT_PPM).count()
        gas_crit = Node.objects.filter(latest_co__gte=settings.CO_CRIT_PPM).count()

        last_record = TelemetryRecord.objects.order_by('-received_at').first()
        last_rx = last_record.received_at if last_record else 0

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
        check_and_update_watchdog()
        nodes = Node.objects.all()
        serializer = NodeSerializer(nodes, many=True)
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
    def post(self, request, alert_id):
        alert = get_object_or_404(SafetyAlert, id=alert_id)
        if alert.status != AlertStatus.NEW:
            return Response({"error": "Alert not found or already acknowledged/resolved", "alert_id": alert_id}, status=status.HTTP_404_NOT_FOUND)

        officer = request.data.get("officer_name", request.data.get("officer", "Safety_Officer"))
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
    def post(self, request, alert_id):
        alert = get_object_or_404(SafetyAlert, id=alert_id)
        if alert.status == AlertStatus.RESOLVED:
            return Response({"error": "Alert already resolved", "alert_id": alert_id}, status=status.HTTP_404_NOT_FOUND)

        officer = request.data.get("officer_name", request.data.get("officer", "Safety_Officer"))
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
