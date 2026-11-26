"""Transport-independent ingestion. A returned receipt means the transaction committed."""
import logging
import time
from django.contrib.auth.hashers import check_password
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied, ValidationError
from .models import (GatewayRegistration, DeviceDiscovery, Node, IngestedEvent,
    DeviceAssignment, LocationObservation, TelemetryRecord, MeasurementReading,
    DeviceCapability, SafetyAlert, AuditEntry, Zone, QuarantinedEvent, LocationEvidence,
    DeviceCommand)
from .wire_validation import (validate_envelope, validate_payload, TelemetryPayloadSerializer,
                             HeartbeatPayloadSerializer, AlertPayloadSerializer, ProvisionPayloadSerializer,
                             LocalAckPayloadSerializer)
from .commands import command_frame


logger = logging.getLogger(__name__)


def attach_downlink_control(gateway, receipt):
    if 'control' in receipt:
        return
    pending_cmd = DeviceCommand.objects.select_for_update().filter(
        gateway=gateway, state='QUEUED', expires_at__gt=timezone.now()
    ).order_by('created_at').first()
    if pending_cmd:
        try:
            receipt['control'] = command_frame(pending_cmd)
            pending_cmd.state = 'SENT'
            pending_cmd.save(update_fields=['state'])
            receipt['command_id'] = str(pending_cmd.pk)
        except Exception as e:
            logger.warning("Failed to prepare command_frame for command %s: %s", pending_cmd.pk, e)


def authenticate_gateway(gateway_id, key):
    gateway = GatewayRegistration.objects.select_related('site__organisation', 'node').filter(
        node_id=gateway_id, active=True, credentials_installed=True, site__active=True, site__organisation__active=True,
        node__archived=False).first()
    if not gateway or not check_password(key or '', gateway.credential_hash):
        raise AuthenticationFailed('Invalid gateway credentials.')
    return gateway


@transaction.atomic
def ingest(gateway, data):
    from .installation import verify_installation
    if not isinstance(data, dict):
        raise ValidationError('Event must be an object.')
    deployment = verify_installation(data)
    kind = data.get('type')
    serializers = {
        'TELEMETRY': TelemetryPayloadSerializer,
        'HEARTBEAT': HeartbeatPayloadSerializer,
        'ALERT': AlertPayloadSerializer,
        'PROV_REQ': ProvisionPayloadSerializer,
        'LOCAL_ACK': LocalAckPayloadSerializer,
    }
    if kind not in serializers:
        raise ValidationError({'error_code': 'VALIDATION_ERROR', 'error': 'Unsupported event type.'})
    envelope, error = validate_envelope(data, kind)
    if error:
        raise ValidationError({**error, 'error_code': 'VALIDATION_ERROR'})
    payload, error = validate_payload(serializers[kind], envelope['payload'])
    if error:
        raise ValidationError({**error, 'error_code': 'VALIDATION_ERROR'})
    # Recheck revocation under lock, including long-lived MQTT sessions.
    gateway = GatewayRegistration.objects.select_for_update(of=('self',)).select_related('site__organisation').get(pk=gateway.pk)
    if not gateway.active or not gateway.credentials_installed or not gateway.site.active or not gateway.site.organisation.active:
        raise PermissionDenied('Gateway has been revoked.')
    sender, seq = envelope['sender'], envelope['seq']
    receipt = {'status': 'ok', 'node_id': sender, 'seq': seq, 'event_type': kind, 'deduplicated': False, 'installation_id': deployment}
    node = Node.objects.select_for_update().filter(pk=sender).first()
    if kind == 'PROV_REQ' or node is None:
        hardware = payload.get('chip_id') or payload.get('chip_mac') or sender
        from .device_trust import clock_reply
        control = clock_reply(gateway, hardware, payload['clock_request']) if payload.get('clock_request') else None
        discovery, created = DeviceDiscovery.objects.get_or_create(gateway=gateway, hardware_id=hardware, defaults={'sender_id': sender, 'payload': data})
        if not created and (control or not discovery.payload.get('payload', {}).get('clock_request')):
            discovery.sender_id = sender
            discovery.payload = data
            discovery.save(update_fields=['sender_id', 'payload', 'last_seen'])
        if control:
            receipt['control'] = control
        quarantined, created = QuarantinedEvent.objects.get_or_create(gateway=gateway, installation_id=deployment, sender_id=sender, event_type=kind, sequence=seq, defaults={'site': gateway.site, 'payload': data})
        attach_downlink_control(gateway, receipt)
        return {**receipt, 'recorded': False, 'discovered': True, 'quarantined': True, 'quarantine_id': quarantined.pk, 'deduplicated': not created}
    if node.site_id != gateway.site_id or node.organisation_id != gateway.site.organisation_id:
        raise PermissionDenied('Sender is not registered in this gateway site.')
    if node.archived or not node.commissioned:
        raise PermissionDenied('Sender is not commissioned and active.')
    if envelope['role'] != node.role:
        raise ValidationError('Reported role differs from registered role.')
    existing = IngestedEvent.objects.filter(node=node, event_type=kind, sequence=seq).only('pk').first()
    if existing:
        if kind == 'ALERT':
            receipt['alert_id'] = SafetyAlert.objects.get(source_event=existing).pk
        attach_downlink_control(gateway, receipt)
        return {**receipt, 'recorded': False, 'deduplicated': True}
    assignment = DeviceAssignment.objects.filter(node=node, ended_at__isnull=True).first()
    event = IngestedEvent.objects.create(node=node, site=gateway.site, gateway=gateway,
        event_type=kind, sequence=seq, payload=data, assignment_at_receipt=assignment)
    now = int(time.time() * 1000)
    simulated = bool(payload.get('sim', payload.get('is_simulated', node.is_simulated)))

    # Direct anchor location evidence determination
    target_zone = None
    target_zone_code = 'UNASSIGNED'
    evidence = LocationEvidence.UNKNOWN
    obs_source = 'SIMULATED' if simulated else 'LEGACY_REPORTED'
    obs_quality = 'UNKNOWN'

    anchor_ctx = envelope.get('anchor')
    if node.role == 'WEARABLE':
        if anchor_ctx:
            obs_source = 'DIRECT_ANCHOR'
            anchor_id = anchor_ctx.get('id')
            anchor_zone_code = anchor_ctx.get('zone')
            link_state = anchor_ctx.get('state', 'UNKNOWN')
            hop = anchor_ctx.get('hop', 99)

            # Direct stationary anchor association requires hop == 1
            if hop == 1 and anchor_id and link_state in ('CURRENT', 'CONFIRMED'):
                zone_lookup = Zone.objects.filter(site=gateway.site, code=anchor_zone_code, active=True).first() if anchor_zone_code and anchor_zone_code != 'UNASSIGNED' else None
                if zone_lookup:
                    target_zone = zone_lookup
                    target_zone_code = anchor_zone_code
                    evidence = LocationEvidence.CURRENT
                    obs_quality = 'VALID'
                else:
                    target_zone_code = anchor_zone_code or 'UNASSIGNED'
                    evidence = LocationEvidence.CURRENT
                    obs_quality = 'UNRESOLVED_ZONE'
            elif link_state == 'TRANSITIONING':
                evidence = LocationEvidence.TRANSITIONING
                obs_quality = 'TRANSITIONING'
                if anchor_zone_code and anchor_zone_code != 'UNASSIGNED':
                    target_zone = Zone.objects.filter(site=gateway.site, code=anchor_zone_code, active=True).first()
                    target_zone_code = anchor_zone_code
            elif link_state == 'AMBIGUOUS':
                evidence = LocationEvidence.AMBIGUOUS
                obs_quality = 'AMBIGUOUS'
                if anchor_zone_code and anchor_zone_code != 'UNASSIGNED':
                    target_zone = Zone.objects.filter(site=gateway.site, code=anchor_zone_code, active=True).first()
                    target_zone_code = anchor_zone_code
            elif link_state == 'LAST_KNOWN':
                evidence = LocationEvidence.LAST_KNOWN
                obs_quality = 'EXPIRED'
                if anchor_zone_code and anchor_zone_code != 'UNASSIGNED':
                    target_zone = Zone.objects.filter(site=gateway.site, code=anchor_zone_code, active=True).first()
                    target_zone_code = anchor_zone_code
            else:
                evidence = LocationEvidence.UNKNOWN
                obs_quality = 'UNKNOWN'
        else:
            evidence = LocationEvidence.UNKNOWN
            obs_quality = 'UNKNOWN'
    else:
        # Stationary infrastructure (ANCHOR or GATEWAY)
        target_zone_code = envelope.get('zone') or node.current_zone
        if target_zone_code and target_zone_code != 'UNASSIGNED':
            target_zone = Zone.objects.filter(site=gateway.site, code=target_zone_code, active=True).first()
        evidence = LocationEvidence.CONFIRMED
        obs_source = 'REGISTERED_INFRASTRUCTURE'
        obs_quality = 'CONFIRMED'

    LocationObservation.objects.create(
        node=node,
        site=gateway.site,
        event=event,
        zone=target_zone,
        reported_zone=target_zone_code,
        simulated=simulated,
        source=obs_source,
        quality=obs_quality,
    )

    newer = seq > node.last_seq
    if kind == 'TELEMETRY':
        co = payload.get('co', payload.get('co_ppm'))
        temp = payload.get('temp', payload.get('temp_c'))
        hum = payload.get('hum', payload.get('humidity_pct'))
        pressure = payload.get('pressure_pa')
        gas_res = payload.get('gas_resistance_ohm')
        batt = payload.get('batt', payload.get('battery_v', 0.0))
        batt_pct = payload.get('battery_pct')
        healthy = payload.get('ok', payload.get('sensor_ok', False))

        resolved_zone = target_zone_code if target_zone_code != 'UNASSIGNED' else envelope.get('zone', '')
        TelemetryRecord.objects.create(
            node=node, site=gateway.site, source_event=event, seq=seq,
            zone=resolved_zone, co_ppm=co or 0.0, temp_c=temp or 0.0, humidity_pct=hum or 0.0,
            fall_detected=payload.get('fall', payload.get('fall_detected', False)), battery_v=batt or 0.0,
            is_simulated=simulated, sensor_ok=healthy, uptime_ms=envelope['uptime'], received_at=now
        )

        channels = []
        if co is not None:
            channels.append(('co_ppm', 'Carbon monoxide', 'ppm', co))
        if temp is not None:
            channels.append(('temperature_c', 'Temperature', '°C', temp))
        if hum is not None:
            channels.append(('humidity_pct', 'Relative humidity', '%RH', hum))
        if pressure is not None:
            channels.append(('pressure_pa', 'Barometric pressure', 'Pa', pressure))
        if gas_res is not None:
            channels.append(('gas_resistance_ohm', 'Gas resistance', 'Ω', gas_res))

        for key, label, unit, value in channels:
            capability, _ = DeviceCapability.objects.get_or_create(
                node=node, measurement_key=key,
                defaults={'display_name': label, 'unit': unit}
            )
            MeasurementReading.objects.create(
                node=node, site=gateway.site, source_event=event,
                capability=capability, measurement_key=key, unit=unit, value=value,
                source_seq=seq, zone=resolved_zone, received_at=now
            )

        if newer:
            if co is not None:
                node.latest_co = co
            if temp is not None:
                node.latest_temp = temp
            if hum is not None:
                node.latest_hum = hum
            node.battery_v = batt or 0.0
            node.sensor_ok = healthy
            node.is_simulated = simulated
    elif kind == 'HEARTBEAT' and newer:
        node.battery_v = payload.get('batt', payload.get('battery_v', 0.0))
        node.free_heap = payload.get('heap', payload.get('free_heap', 0))
    elif kind == 'ALERT':
        resolved_zone = target_zone_code if target_zone_code != 'UNASSIGNED' else envelope.get('zone', '')
        alert = SafetyAlert.objects.create(
            node=node, site=gateway.site, source_event=event,
            seq=seq, zone=resolved_zone, severity=payload['severity'],
            alert_code=payload.get('code', payload.get('alert_code')), details=payload.get('details', ''),
            trigger_value=payload.get('val', payload.get('trigger_value', 0.0)), created_at=now
        )
        receipt['alert_id'] = alert.pk
        AuditEntry.objects.create(
            site=gateway.site, timestamp=now, actor=sender, action='ALERT_TRIGGERED',
            entity_type='safetyalert', entity_id=str(alert.pk), metadata={'event_id': event.pk}
        )
    elif kind == 'LOCAL_ACK':
        cleared = payload.get('cleared', payload.get('cleared_alarms', 0))
        held_ms = payload.get('held_ms', 2000)
        AuditEntry.objects.create(
            site=gateway.site, timestamp=now, actor=sender, action='LOCAL_ALARM_ACKNOWLEDGED',
            entity_type='node', entity_id=sender,
            details=f"Wearable physical acknowledge button held for {held_ms} ms (cleared mask: 0x{cleared:02X})",
            metadata={'cleared_alarms': cleared, 'held_ms': held_ms, 'event_id': event.pk}
        )

    if newer:
        node.last_seq = seq
        node.last_seen_ts = now
        node.status = 'ONLINE'
        if evidence in (LocationEvidence.CURRENT, LocationEvidence.CONFIRMED):
            node.current_zone = target_zone_code
            node.zone_ref = target_zone
            node.location_evidence = evidence
            node.location_observed_at = now
        elif evidence in (LocationEvidence.TRANSITIONING, LocationEvidence.AMBIGUOUS, LocationEvidence.LAST_KNOWN):
            node.location_evidence = evidence
            if target_zone:
                node.current_zone = target_zone_code
                node.zone_ref = target_zone
        else:
            if not node.zone_ref:
                node.current_zone = 'UNASSIGNED'
                node.zone_ref = None
                node.location_evidence = LocationEvidence.UNKNOWN
                node.location_observed_at = 0
            else:
                node.location_evidence = LocationEvidence.LAST_KNOWN

        changed = ['last_seq', 'last_seen_ts', 'status', 'current_zone', 'zone_ref',
                   'location_evidence', 'location_observed_at']
        if kind == 'TELEMETRY':
            changed += ['latest_co', 'latest_temp', 'latest_hum', 'battery_v', 'sensor_ok', 'is_simulated']
        elif kind == 'HEARTBEAT':
            changed += ['battery_v', 'free_heap']
        node.save(update_fields=changed)
    attach_downlink_control(gateway, receipt)
    return {**receipt, 'recorded': True, 'event_id': event.pk}
