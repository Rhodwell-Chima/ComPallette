"""Local per-device keys and signed, boot-bound control frames.

Keys are mounted read-only from protected provisioning storage, never serialized
to an operator API. Sign the exact UTF-8 body, not an independently canonicalized
copy at the receiver.
"""
import hashlib
import hmac
import json
import re
import secrets
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


def ensure_device_key(hardware, site_id, secret_hex=None):
    """Ensure an enrollment key JSON file exists on disk for this hardware and site.
    Generates a cryptographically secure 256-bit random key if none exists.
    Supports supplying a 64-character hex pre-shared secret.
    """
    if not isinstance(hardware, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,32}', hardware):
        raise ValidationError('Invalid hardware identity.')
    if not settings.COMPALLETTE_DEVICE_KEY_DIR:
        raise PermissionDenied('Local enrollment keys are not configured.')

    key_dir = Path(settings.COMPALLETTE_DEVICE_KEY_DIR)
    key_dir.mkdir(parents=True, exist_ok=True)
    key_path = key_dir / f'{hardware}.json'

    # If a custom secret is provided, validate it strictly
    custom_bytes = None
    if secret_hex is not None and isinstance(secret_hex, str) and secret_hex.strip():
        clean_hex = secret_hex.strip()
        if not re.fullmatch(r'[0-9a-fA-F]{64}', clean_hex):
            raise ValidationError('Device key must be exactly 256 bits (64 hexadecimal characters).')
        try:
            custom_bytes = bytes.fromhex(clean_hex)
        except ValueError:
            raise ValidationError('Device key contains invalid hexadecimal characters.')
    elif secret_hex is not None and not isinstance(secret_hex, str):
        raise ValidationError('Device key must be a 64-character hexadecimal string.')

    # Check existing key file on disk
    if key_path.exists():
        try:
            data = json.loads(key_path.read_text(encoding='utf-8'))
            if (
                data.get('installation_id') == installation_id()
                and data.get('site_id') == site_id
                and data.get('hardware_id') == hardware
            ):
                existing_key = bytes.fromhex(data['key'])
                if len(existing_key) == 32:
                    if custom_bytes is None or existing_key == custom_bytes:
                        return existing_key
        except (OSError, ValueError, KeyError, TypeError):
            pass

    key_bytes = custom_bytes if custom_bytes is not None else secrets.token_bytes(32)
    data = {
        'installation_id': installation_id(),
        'site_id': site_id,
        'hardware_id': hardware,
        'key': key_bytes.hex(),
    }

    tmp_path = key_dir / f'.{hardware}.tmp.{secrets.token_hex(4)}'
    try:
        tmp_path.write_text(json.dumps(data, indent=2), encoding='utf-8')
        tmp_path.replace(key_path)
    except OSError as e:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        raise PermissionDenied(f'Failed to persist device enrollment key: {e}')

    return key_bytes


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
