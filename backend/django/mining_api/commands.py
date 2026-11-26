"""Durable command outbox and monotonic acknowledgement processing."""
import uuid
import hashlib
import json
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied
from .models import DeviceCommand, Node, AuditEntry

TERMINAL = {'DEVICE_CONFIRMED', 'REJECTED', 'EXPIRED'}


@transaction.atomic
def command_result(gateway, message):
    if not isinstance(message, dict):
        raise ValidationError('Confirmation must be an object.')
    try:
        command_id = uuid.UUID(str(message.get('command_id', '')))
    except ValueError:
        raise ValidationError('A valid command UUID is required.')
    command = DeviceCommand.objects.select_for_update().filter(pk=command_id, gateway=gateway).first()
    if command is None:
        raise ValidationError('Unknown command for this gateway.')
    state = message.get('state')
    if state not in {'GATEWAY_RECEIVED', 'DEVICE_CONFIRMED', 'REJECTED'}:
        raise ValidationError('Invalid confirmation state.')
    if message.get('node_id') != command.node_id:
        raise PermissionDenied('Confirmation target mismatch.')
    if state in {'DEVICE_CONFIRMED', 'REJECTED'} and message.get('hardware_id') != command.node.hardware_id:
        raise ValidationError('Confirmed hardware does not match the target.')
    if command.state in TERMINAL:
        record_result(command, message)
        return {'command_id': str(command.pk), 'state': command.state, 'received_state': state}
    if command.expires_at <= timezone.now():
        command.state = 'EXPIRED'
    else:
        command.state = state
        command.result = message
        if state == 'DEVICE_CONFIRMED':
            if command.kind == 'PROVISION':
                Node.objects.filter(pk=command.node_id).update(commissioned=True, status='ONLINE')
                from .models import QuarantinedEvent, DeviceDiscovery
                hardware = command.node.hardware_id
                DeviceDiscovery.objects.filter(gateway=gateway, hardware_id=hardware).delete()
                QuarantinedEvent.objects.filter(site=gateway.site, sender_id=hardware).delete()
                QuarantinedEvent.objects.filter(site=gateway.site, sender_id=command.node_id).delete()
                if hardware:
                    QuarantinedEvent.objects.filter(site=gateway.site, sender_id=f'PROV-{hardware}').delete()
    command.save(update_fields=['state', 'result'])
    record_result(command, message)
    return {'command_id': str(command.pk), 'state': command.state, 'received_state': state}


def record_result(command, message):
    # The command row is locked by the caller. A repeated result has one audit effect,
    # including late confirmations which must not revive an expired command.
    digest = hashlib.sha256(json.dumps(message, sort_keys=True).encode()).hexdigest()
    if AuditEntry.objects.filter(action='COMMAND_RESULT', metadata__command_id=str(command.pk), metadata__result_digest=digest).exists():
        return
    from .operations import audit
    audit(command.actor, command.gateway.site, 'COMMAND_RESULT', command.node,
          {'command_id': str(command.pk), 'state': command.state,
           'received_state': message['state'], 'result_digest': digest, 'result': message})


def command_frame(command):
    from .device_trust import signed_command
    return signed_command(command)
