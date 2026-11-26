import hashlib
import json
import re
from datetime import timedelta
from django.contrib.auth.hashers import make_password
from django.db import transaction, IntegrityError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from .access import enforce, permitted_sites
from .models import Node, GatewayRegistration, DeviceDiscovery, DeviceCommand, Zone, PlatformOperation
from .operations import audit, Conflict


class GatewaysView(APIView):
    def get(self, request):
        site = get_object_or_404(permitted_sites(request.user), pk=request.query_params.get('site'))
        enforce(request.user, 'manage_devices', site)
        return Response({'gateways': list(GatewayRegistration.objects.filter(site=site).values('id', 'node_id', 'site_id', 'active', 'credential_version', 'credentials_installed')),
            'discoveries': list(DeviceDiscovery.objects.filter(gateway__site=site).values('id', 'gateway_id', 'hardware_id', 'sender_id', 'last_seen', 'version')),
            'devices': list(Node.objects.filter(site=site, archived=False, commissioned=True).values('node_id', 'hardware_id', 'version', 'role')),
            'commands': list(DeviceCommand.objects.filter(gateway__site=site).order_by('-created_at').values()[:100])})

    def post(self, request):
        try:
            return self._post(request)
        except IntegrityError as error:
            raise Conflict('A competing change was saved. Refresh before retrying.') from error

    @transaction.atomic
    def _post(self, request):
        site = get_object_or_404(permitted_sites(request.user), pk=request.data.get('site'))
        enforce(request.user, 'manage_devices', site)
        import uuid
        try:
            operation_id = uuid.UUID(str(request.data.get('operation_id', '')))
        except ValueError:
            raise ValidationError({'operation_id': 'A UUID is required.'})
        type(request.user).objects.select_for_update(no_key=True).get(pk=request.user.pk)
        digest = hashlib.sha256(json.dumps(['gateway', request.data], sort_keys=True).encode()).hexdigest()
        prior = PlatformOperation.objects.filter(pk=operation_id).first()
        if prior:
            if prior.actor_id != request.user.pk or prior.request_digest != digest:
                raise Conflict('Operation ID was already used for a different request.')
            return Response(prior.result)
        action = request.data.get('action', 'register')
        if action == 'register':
            node_id = str(request.data.get('node_id', '')).strip()
            hardware = str(request.data.get('hardware_id', '')).strip()
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,23}', node_id) or not re.fullmatch(r'[A-Za-z0-9_-]{1,32}', hardware):
                raise ValidationError('A wire-compatible node ID and hardware ID are required.')
            if Node.objects.filter(pk=node_id).exists() or Node.objects.filter(hardware_id=hardware).exists():
                raise ValidationError('Node or hardware identity already exists.')
            node = Node.objects.create(node_id=node_id, hardware_id=hardware, site=site,
                organisation=site.organisation, role='GATEWAY', commissioned=False, status='OFFLINE', is_simulated=False)
            gateway = GatewayRegistration.objects.create(node=node, site=site, credential_hash='!', credentials_installed=False)
        else:
            gateway = get_object_or_404(GatewayRegistration.objects.select_for_update(), pk=request.data.get('gateway_id'), site=site)
            if type(request.data.get('expected_version')) is not int or request.data['expected_version'] != gateway.credential_version:
                raise Conflict('Gateway credentials changed. Refresh before retrying.')
            if action == 'revoke':
                gateway.active = False; gateway.credentials_installed = False; gateway.credential_hash = '!'
                gateway.save(update_fields=['active', 'credentials_installed', 'credential_hash'])
                audit(request.user, site, 'GATEWAY_REVOKED', gateway.node, {})
                result = {'status': 'revoked', 'notice': 'Application access revoked. Run local credential tooling to remove broker access and disconnect sessions.'}
                PlatformOperation.objects.create(id=operation_id, actor=request.user, request_digest=digest, result=result)
                return Response(result)
            if action != 'rotate': raise ValidationError('Unsupported action.')
            gateway.credential_hash = '!'; gateway.credential_version += 1; gateway.credentials_installed = False
            gateway.save(update_fields=['credential_hash', 'credential_version', 'credentials_installed'])
        audit(request.user, site, 'GATEWAY_CREDENTIAL', gateway.node, {'version': gateway.credential_version})
        result = {'gateway_id': gateway.pk, 'node_id': gateway.node_id, 'credentials_installed': False,
            'notice': 'Registration saved. Install credentials with the protected local provisioning tool before enabling traffic.'}
        PlatformOperation.objects.create(id=operation_id, actor=request.user, request_digest=digest, result=result)
        return Response(result, status=201)


class CommandsView(APIView):
    def post(self, request):
        try:
            return self._post(request)
        except IntegrityError as error:
            raise Conflict('A competing change was saved. Refresh before retrying.') from error

    @transaction.atomic
    def _post(self, request):
        type(request.user).objects.select_for_update(no_key=True).get(pk=request.user.pk)
        gateway = get_object_or_404(GatewayRegistration.objects.select_for_update(of=('self',)).select_related('site'), pk=request.data.get('gateway_id'), active=True, credentials_installed=True)
        enforce(request.user, 'manage_devices', gateway.site)
        kind = request.data.get('kind')
        if kind not in ('PROVISION', 'DIAGNOSTIC'):
            raise ValidationError('Only provisioning and diagnostics are supported.')
        import uuid
        try: operation_id = uuid.UUID(str(request.data.get('operation_id', '')))
        except ValueError: raise ValidationError('A command operation UUID is required.')
        digest = hashlib.sha256(json.dumps(request.data, sort_keys=True).encode()).hexdigest()
        existing = DeviceCommand.objects.filter(pk=operation_id).first()
        if existing:
            if existing.actor_id != request.user.pk or existing.request_digest != digest:
                raise Conflict('Operation ID was already used for a different request.')
            return Response({'command_id': str(existing.pk), 'state': existing.state})
        expected_version = request.data.get('expected_version')
        if type(expected_version) is not int:
            raise ValidationError({'expected_version': 'An integer version is required.'})
        node_id = str(request.data.get('node_id', '')).strip()
        payload = {}
        if kind == 'PROVISION':
            discovery = get_object_or_404(DeviceDiscovery.objects.select_for_update(), pk=request.data.get('discovery_id'), gateway=gateway)
            if discovery.version != expected_version:
                raise Conflict('Discovery changed. Refresh before commissioning.')
            role = request.data.get('role', 'WEARABLE')
            if role not in ('WEARABLE', 'ANCHOR') or not re.fullmatch(r'[A-Za-z0-9_-]{1,23}', node_id):
                raise ValidationError('Use a valid tracking/anchor role and wire-compatible node ID.')
            if Node.objects.filter(pk=node_id).exists() or Node.objects.filter(hardware_id=discovery.hardware_id).exists():
                raise ValidationError('Identity already registered; inspect its existing command.')
            zone = get_object_or_404(Zone, pk=request.data['zone_id'], site=gateway.site, active=True) if request.data.get('zone_id') else None
            if role == 'ANCHOR' and zone is None:
                raise ValidationError({'zone_id': 'An installation zone is required for an anchor.'})
            if zone and len(zone.code) > 23: raise ValidationError('Zone code exceeds current firmware capacity.')
            from .device_trust import ensure_device_key
            provided_key = request.data.get('device_key')
            ensure_device_key(discovery.hardware_id, gateway.site_id, secret_hex=provided_key)
            node = Node.objects.create(node_id=node_id, hardware_id=discovery.hardware_id,
                site=gateway.site, organisation=gateway.site.organisation, role=role,
                status='OFFLINE', is_simulated=False, installation_zone=zone if role == 'ANCHOR' else None)
            discovery.version += 1
            discovery.save(update_fields=['version'])
            payload = {'role': role, 'zone': zone.code if zone and role == 'ANCHOR' else 'UNASSIGNED'}
        else:
            node = get_object_or_404(Node.objects.select_for_update(), pk=node_id, site=gateway.site, archived=False, commissioned=True)
            if node.version != expected_version:
                raise Conflict('Device changed. Refresh before requesting diagnostics.')
        command = DeviceCommand.objects.create(id=operation_id, gateway=gateway, node=node,
            actor=request.user, kind=kind, payload=payload, request_digest=digest,
            expires_at=timezone.now() + timedelta(seconds=300 if kind == 'PROVISION' else 30))
        audit(request.user, gateway.site, 'COMMAND_QUEUED', node, {'command_id': str(command.pk), 'kind': kind})
        return Response({'command_id': str(command.pk), 'state': command.state}, status=201)
