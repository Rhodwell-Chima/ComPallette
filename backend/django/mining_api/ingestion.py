"""Transport-independent ingestion. A returned receipt means the transaction committed."""
import time
from django.contrib.auth.hashers import check_password
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied, ValidationError
from .models import (GatewayRegistration, DeviceDiscovery, Node, IngestedEvent,
    DeviceAssignment, LocationObservation, TelemetryRecord, MeasurementReading,
    DeviceCapability, SafetyAlert, AuditEntry, Zone)
from .wire_validation import (validate_envelope, validate_payload, TelemetryPayloadSerializer,
                             HeartbeatPayloadSerializer, AlertPayloadSerializer, ProvisionPayloadSerializer)


def authenticate_gateway(gateway_id, key):
    gateway = GatewayRegistration.objects.select_related('site__organisation', 'node').filter(
        node_id=gateway_id, active=True, site__active=True, site__organisation__active=True,
        node__archived=False).first()
    if not gateway or not check_password(key or '', gateway.credential_hash):
        raise AuthenticationFailed('Invalid gateway credentials.')
    return gateway


@transaction.atomic
def ingest(gateway, data):
    kind = data.get('type') if isinstance(data, dict) else None
    serializers = {'TELEMETRY': TelemetryPayloadSerializer, 'HEARTBEAT': HeartbeatPayloadSerializer,
                   'ALERT': AlertPayloadSerializer, 'PROV_REQ': ProvisionPayloadSerializer}
    if kind not in serializers:
        raise ValidationError({'error_code': 'VALIDATION_ERROR', 'error': 'Unsupported event type.'})
    envelope, error = validate_envelope(data, kind)
    if error:
        raise ValidationError({**error, 'error_code': 'VALIDATION_ERROR'})
    payload, error = validate_payload(serializers[kind], envelope['payload'])
    if error:
        raise ValidationError({**error, 'error_code': 'VALIDATION_ERROR'})
    # Recheck revocation under lock, including long-lived MQTT sessions.
    gateway = GatewayRegistration.objects.select_for_update().select_related('site').get(pk=gateway.pk)
    if not gateway.active or not gateway.site.active or not gateway.site.organisation.active:
        raise PermissionDenied('Gateway has been revoked.')
    sender, seq = envelope['sender'], envelope['seq']
    receipt = {'status': 'ok', 'node_id': sender, 'seq': seq, 'event_type': kind, 'deduplicated': False}
    node = Node.objects.select_for_update().filter(pk=sender).first()
    if kind == 'PROV_REQ' or node is None:
        hardware = payload.get('chip_id') or payload.get('chip_mac') or sender
        DeviceDiscovery.objects.update_or_create(gateway=gateway, hardware_id=hardware,
            defaults={'sender_id': sender, 'payload': data})
        return {**receipt, 'recorded': False, 'discovered': True}
    if node.site_id != gateway.site_id or node.organisation_id != gateway.site.organisation_id:
        raise PermissionDenied('Sender is not registered in this gateway site.')
    if node.archived or not node.commissioned:
        raise PermissionDenied('Sender is not commissioned and active.')
    if envelope['role'] != node.role:
        raise ValidationError('Reported role differs from registered role.')
    existing = IngestedEvent.objects.filter(node=node, event_type=kind, sequence=seq).first()
    if existing:
        if kind == 'ALERT':
            receipt['alert_id'] = SafetyAlert.objects.get(source_event=existing).pk
        return {**receipt, 'recorded': False, 'deduplicated': True}
    assignment = DeviceAssignment.objects.filter(node=node, ended_at__isnull=True).first()
    event = IngestedEvent.objects.create(node=node, site=gateway.site, gateway=gateway,
        event_type=kind, sequence=seq, payload=data, assignment_at_receipt=assignment)
    now = int(time.time() * 1000)
    zone_code = envelope['zone']
    zone = Zone.objects.filter(site=gateway.site, code=zone_code, active=True).first()
    simulated = bool(payload.get('sim', payload.get('is_simulated', node.is_simulated)))
    LocationObservation.objects.create(node=node, site=gateway.site, event=event,
        zone=zone, reported_zone=zone_code, simulated=simulated,
        source='SIMULATED' if simulated else 'LEGACY_REPORTED', quality='UNKNOWN')
    # Legacy packets contain no proof of mobile presence or trustworthy capture time.
    newer = seq > node.last_seq
    if kind == 'TELEMETRY':
        co = payload.get('co', payload.get('co_ppm'))
        temp = payload.get('temp', payload.get('temp_c'))
        hum = payload.get('hum', payload.get('humidity_pct'))
        batt = payload.get('batt', payload.get('battery_v', 0))
        healthy = payload.get('ok', payload.get('sensor_ok', False))
        TelemetryRecord.objects.create(node=node, site=gateway.site, source_event=event, seq=seq,
            zone=zone_code, co_ppm=co, temp_c=temp or 0, humidity_pct=hum or 0,
            fall_detected=payload.get('fall', payload.get('fall_detected', False)), battery_v=batt,
            is_simulated=simulated, sensor_ok=healthy, uptime_ms=envelope['uptime'], received_at=now)
        for key, label, unit, value in [('co_ppm', 'Carbon monoxide', 'ppm', co),
                ('temperature_c', 'Temperature', '°C', temp), ('humidity_pct', 'Relative humidity', '%RH', hum)]:
            if value is None:
                continue
            capability, _ = DeviceCapability.objects.get_or_create(node=node, measurement_key=key,
                defaults={'display_name': label, 'unit': unit})
            MeasurementReading.objects.create(node=node, site=gateway.site, source_event=event,
                capability=capability, measurement_key=key, unit=unit, value=value,
                source_seq=seq, zone=zone_code, received_at=now)
        if newer:
            node.latest_co, node.latest_temp, node.latest_hum = co, temp or 0, hum or 0
            node.battery_v, node.sensor_ok, node.is_simulated = batt, healthy, simulated
    elif kind == 'HEARTBEAT' and newer:
        node.battery_v = payload.get('batt', payload.get('battery_v', 0))
        node.free_heap = payload.get('heap', payload.get('free_heap', 0))
    elif kind == 'ALERT':
        alert = SafetyAlert.objects.create(node=node, site=gateway.site, source_event=event,
            seq=seq, zone=zone_code, severity=payload['severity'],
            alert_code=payload.get('code', payload.get('alert_code')), details=payload.get('details', ''),
            trigger_value=payload.get('val', payload.get('trigger_value', 0)), created_at=now)
        receipt['alert_id'] = alert.pk
        AuditEntry.objects.create(site=gateway.site, timestamp=now, actor=sender, action='ALERT_TRIGGERED',
            entity_type='safetyalert', entity_id=str(alert.pk), metadata={'event_id': event.pk})
    if newer:
        node.last_seq = seq
        node.last_seen_ts = now
        node.status = 'ONLINE'
        node.current_zone = 'UNASSIGNED'
        node.zone_ref = None
        node.location_evidence = 'UNKNOWN'
        node.location_observed_at = 0
        node.save()
    return {**receipt, 'recorded': True, 'event_id': event.pk}
