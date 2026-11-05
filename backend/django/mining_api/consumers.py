import json
import time
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.conf import settings
from .models import (
    Node,
    TelemetryRecord,
    SafetyAlert,
    AuditEntry,
    NodeStatus,
    NodeRole,
    AlertStatus,
    AlertSeverity
)

# ============================================================================
# COMPALLETTE - REAL-TIME GATEWAY WEBSOCKET INGESTION CONSUMER
# ============================================================================
# Provides a persistent, bi-directional, low-latency socket between the surface
# Django backend and the physical ESP32 Gateway border router.
#
# Uplink   : High-throughput telemetry, keep-alive heartbeats, emergency alerts.
# Downlink : Instantaneous surface safety overrides (e.g., EVACUATE MINE).

class GatewayConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        # Extract headers and query parameters
        headers = dict(self.scope.get('headers', []))
        api_key = headers.get(b'x-api-key', b'').decode('utf-8')

        expected_key = getattr(settings, 'COMPALLETTE_API_KEY', '')

        # Verify API key
        if not expected_key or api_key != expected_key:
            print("[WS GATEWAY REJECT] Unauthorized WebSocket connection attempt")
            await self.close(code=4001)
            return

        self.gateway_id = headers.get(b'x-gateway-id', b'GW-SURFACE-01').decode('utf-8')
        self.group_name = "compallette_gateways"

        # Register with channel layer group for surface broadcasts
        if self.channel_layer:
            await self.channel_layer.group_add(self.group_name, self.channel_name)

        await self.accept()

        now_ms = int(time.time() * 1000)
        client = self.scope.get('client')
        print(f"\n[WS GATEWAY CONNECTED] Gateway '{self.gateway_id}' connected from {client}")

        # Send connection confirmation ACK
        await self.send(text_data=json.dumps({
            "type": "CONNECTION_ACK",
            "gateway_id": self.gateway_id,
            "status": "ONLINE",
            "server_time_ms": now_ms
        }))

    async def disconnect(self, close_code):
        gw = getattr(self, 'gateway_id', 'UNKNOWN')
        print(f"\n[WS GATEWAY DISCONNECTED] Gateway '{gw}' disconnected (code {close_code})")
        if self.channel_layer and hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return

        try:
            data = json.loads(text_data)
        except Exception as e:
            print(f"[WS GATEWAY] Invalid JSON payload received: {e}")
            return

        # Process packet in database
        result = await self.process_packet(data)

        # Send ACK back to Gateway
        if result:
            await self.send(text_data=json.dumps(result))

    @database_sync_to_async
    def process_packet(self, data):
        now_ms = int(time.time() * 1000)
        msg_type = data.get("type", data.get("msg_type", 0))
        sender_id = data.get("sender", data.get("sender_id", "UNKNOWN"))
        role = data.get("role", NodeRole.WEARABLE)
        zone = data.get("zone", data.get("zone_id", "UNASSIGNED"))
        seq = int(data.get("seq", 0))
        payload = data.get("payload", {})

        # --------------------------------------------------------------------
        # 1. TELEMETRY PACKET (msg_type == 2 or "TELEMETRY")
        # --------------------------------------------------------------------
        if msg_type == 2 or msg_type == "TELEMETRY":
            co_ppm = float(payload.get("co", payload.get("co_ppm", 0.0)))
            temp_c = float(payload.get("temp", payload.get("temp_c", 0.0)))
            hum = float(payload.get("hum", payload.get("humidity_pct", 0.0)))
            fall = bool(payload.get("fall", payload.get("fall_detected", False)))
            batt = float(payload.get("batt", payload.get("battery_v", 0.0)))
            sim = bool(payload.get("sim", payload.get("is_simulated", False)))
            sok = bool(payload.get("sok", payload.get("sensor_ok", True)))
            uptime_ms = int(data.get("uptime_ms", 0))

            node, _ = Node.objects.get_or_create(
                node_id=sender_id,
                defaults={'role': role, 'current_zone': zone, 'last_seen_ts': now_ms, 'status': NodeStatus.ONLINE}
            )

            # Record telemetry in database
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

            return {
                "status": "ok",
                "ack_seq": seq,
                "node_id": sender_id,
                "type": "TELEMETRY_ACK",
                "server_time_ms": now_ms
            }

        # --------------------------------------------------------------------
        # 2. HEARTBEAT PACKET (msg_type == 1 or "HEARTBEAT")
        # --------------------------------------------------------------------
        elif msg_type == 1 or msg_type == "HEARTBEAT":
            heap = int(payload.get("heap", payload.get("free_heap", 0)))
            batt = float(payload.get("batt", payload.get("battery_v", 0.0)))

            Node.objects.update_or_create(
                node_id=sender_id,
                defaults={
                    'role': role,
                    'current_zone': zone,
                    'last_seen_ts': now_ms,
                    'battery_v': batt,
                    'free_heap': heap,
                    'status': NodeStatus.ONLINE
                }
            )

            return {
                "status": "ok",
                "ack_seq": seq,
                "node_id": sender_id,
                "type": "HEARTBEAT_ACK",
                "server_time_ms": now_ms
            }

        # --------------------------------------------------------------------
        # 3. ALERT PACKET (msg_type == 3 or "ALERT")
        # --------------------------------------------------------------------
        elif msg_type == 3 or msg_type == "ALERT":
            sev = payload.get("severity", AlertSeverity.WARNING)
            code = payload.get("code", payload.get("alert_code", "UNKNOWN"))
            details = payload.get("details", "")
            val = float(payload.get("val", payload.get("trigger_value", 0.0)))

            node, _ = Node.objects.get_or_create(
                node_id=sender_id,
                defaults={'role': role, 'current_zone': zone, 'last_seen_ts': now_ms, 'status': NodeStatus.ONLINE}
            )

            existing = SafetyAlert.objects.filter(node=node, seq=seq, alert_code=code).first()
            if not existing:
                SafetyAlert.objects.create(
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
                    actor=sender_id,
                    action='ALERT_TRIGGERED',
                    details=f"[WS] Severity: {sev} | Code: {code} | Zone: {zone} | Val: {val}"
                )

            node.last_seen_ts = now_ms
            node.current_zone = zone
            node.status = NodeStatus.ONLINE
            node.save(update_fields=['last_seen_ts', 'current_zone', 'status'])

            return {
                "status": "ok",
                "ack_seq": seq,
                "node_id": sender_id,
                "type": "ALERT_ACK",
                "server_time_ms": now_ms
            }

        return {
            "status": "ok",
            "ack_seq": seq,
            "node_id": sender_id,
            "server_time_ms": now_ms
        }

    # Downlink Push: Surface -> Underground Gateway
    async def gateway_downlink(self, event):
        payload = event.get("payload", {})
        await self.send(text_data=json.dumps(payload))
