"""Local per-device keys and signed, boot-bound control frames.

Keys are mounted read-only from protected provisioning storage, never serialized
to an operator API. Sign the exact UTF-8 body, not an independently canonicalized
copy at the receiver.
"""
import hashlib
import hmac
import json
import re
import time
from pathlib import Path
from django.conf import settings
from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError
from .installation import installation_id, verify_installation


def device_key(hardware, site_id):
    if not isinstance(hardware, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,32}', hardware):
        raise ValidationError('Invalid hardware identity.')
    if not settings.COMPALLETTE_DEVICE_KEY_DIR:
        raise PermissionDenied('Local enrollment keys are not configured.')
    try:
        data = json.loads((Path(settings.COMPALLETTE_DEVICE_KEY_DIR) / f'{hardware}.json').read_text(encoding='utf-8'))
        if data['installation_id'] != installation_id() or data['site_id'] != site_id or data['hardware_id'] != hardware:
            raise ValueError('Key context mismatch')
        key = bytes.fromhex(data['key'])
        if len(key) != 32:
            raise ValueError('Key must be 256 bits')
        return key
    except (OSError, ValueError, KeyError, TypeError):
        raise PermissionDenied('Install a valid local enrollment key for this hardware and site.')


def sign(body, key):
    encoded = json.dumps(body, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    return {'signed_body': encoded, 'mac': hmac.new(key, encoded.encode(), hashlib.sha256).hexdigest()}


def verify(frame, key):
    if not isinstance(frame, dict):
        raise ValidationError('A signed control frame is required.')
    encoded, mac = frame.get('signed_body'), frame.get('mac')
    if not isinstance(encoded, str) or len(encoded.encode()) > 1536 or not isinstance(mac, str):
        raise ValidationError('Invalid signed control frame.')
    expected = hmac.new(key, encoded.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, mac):
        raise PermissionDenied('Device control authentication failed.')
    try:
        body = json.loads(encoded)
    except ValueError:
        raise ValidationError('Invalid signed body.')
    if not isinstance(body, dict):
        raise ValidationError('Signed body must be an object.')
    verify_installation(body)
    return body


def clock_reply(gateway, hardware, frame):
    key = device_key(hardware, gateway.site_id)
    body = verify(frame, key)
    if body.get('kind') != 'TIME_REQUEST' or body.get('hardware_id') != hardware:
        raise ValidationError('Invalid time request target.')
    for name in ('boot_nonce', 'sync_nonce'):
        if not isinstance(body.get(name), str) or not re.fullmatch('[0-9a-f]{32}', body[name]):
            raise ValidationError('A fresh boot and synchronization challenge are required.')
    return {'hardware_id': hardware, **sign({**body, 'kind': 'TIME_RESPONSE', 'server_time_ms': int(time.time() * 1000)}, key)}


def signed_command(command):
    from .models import DeviceDiscovery
    key = device_key(command.node.hardware_id, command.gateway.site_id)
    discovery = DeviceDiscovery.objects.filter(gateway=command.gateway, hardware_id=command.node.hardware_id).first()
    if discovery is None:
        raise ValidationError('Awaiting authenticated hardware discovery.')
    proof = verify(discovery.payload.get('payload', {}).get('clock_request'), key)
    if proof.get('hardware_id') != command.node.hardware_id or proof.get('kind') != 'TIME_REQUEST':
        raise ValidationError('Invalid discovery identity proof.')
    body = {'version': 2, 'installation_id': installation_id(), 'boot_nonce': proof['boot_nonce'],
            'command_id': str(command.pk), 'kind': command.kind, 'node_id': command.node_id,
            'hardware_id': command.node.hardware_id, 'issued_at_ms': int(command.created_at.timestamp() * 1000),
            'expires_at': int(command.expires_at.timestamp()), 'payload': command.payload}
    return {'hardware_id': command.node.hardware_id, 'command_id': str(command.pk), 'node_id': command.node_id, **sign(body, key)}


@transaction.atomic
def accept_result(gateway, frame):
    from .models import GatewayRegistration
    gateway = GatewayRegistration.objects.select_for_update().get(pk=gateway.pk)
    if not gateway.active or not gateway.credentials_installed or not gateway.site.active or not gateway.site.organisation.active:
        raise PermissionDenied('Gateway access is disabled.')
    from .commands import command_result
    if isinstance(frame, dict) and frame.get('kind') == 'GATEWAY_RECEIPT':
        verify_installation(frame)
        if frame.get('state') != 'GATEWAY_RECEIVED':
            raise ValidationError('A gateway receipt cannot confirm device execution.')
        return command_result(gateway, frame)
    # Outer routing fields are untrusted; the signed body must repeat them.
    hardware = frame.get('hardware_id') if isinstance(frame, dict) else None
    body = verify(frame, device_key(hardware, gateway.site_id))
    if body.get('hardware_id') != hardware or body.get('kind') != 'COMMAND_RESULT':
        raise PermissionDenied('Result target mismatch.')
    if body.get('state') not in {'DEVICE_CONFIRMED', 'REJECTED'}:
        raise ValidationError('A device result must confirm or reject execution.')
    return command_result(gateway, body)
