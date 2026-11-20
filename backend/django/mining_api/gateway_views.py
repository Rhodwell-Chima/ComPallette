import secrets
import re
from datetime import timedelta
from django.contrib.auth.hashers import make_password
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from .access import enforce, permitted_sites
from .models import Node, GatewayRegistration, DeviceDiscovery, DeviceCommand, Zone
from .operations import audit


class GatewaysView(APIView):
    def get(self, request):
        site = get_object_or_404(permitted_sites(request.user), pk=request.query_params.get('site'))
        enforce(request.user, 'manage_devices', site)
        return Response({'gateways': list(GatewayRegistration.objects.filter(site=site).values('id', 'node_id', 'site_id', 'active', 'credential_version')),
            'discoveries': list(DeviceDiscovery.objects.filter(gateway__site=site).values('id', 'gateway_id', 'hardware_id', 'sender_id', 'last_seen')),
            'commands': list(DeviceCommand.objects.filter(gateway__site=site).order_by('-created_at').values()[:100])})

    @transaction.atomic
    def post(self, request):
        site = get_object_or_404(permitted_sites(request.user), pk=request.data.get('site'))
        enforce(request.user, 'manage_devices', site)
        action = request.data.get('action', 'register')
        if action == 'register':
            node_id = str(request.data.get('node_id', '')).strip()
            hardware = str(request.data.get('hardware_id', '')).strip()
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,23}', node_id) or not re.fullmatch(r'[A-Za-z0-9_-]{1,32}', hardware):
                raise ValidationError('A wire-compatible node ID and hardware ID are required.')
            if Node.objects.filter(pk=node_id).exists() or Node.objects.filter(hardware_id=hardware).exists():
                raise ValidationError('Node or hardware identity already exists.')
            node = Node.objects.create(node_id=node_id, hardware_id=hardware, site=site,
                organisation=site.organisation, role='GATEWAY', commissioned=True, status='OFFLINE', is_simulated=False)
            secret = secrets.token_urlsafe(32)
            gateway = GatewayRegistration.objects.create(node=node, site=site, credential_hash=make_password(secret))
        else:
            gateway = get_object_or_404(GatewayRegistration.objects.select_for_update(), pk=request.data.get('gateway_id'), site=site)
            if action == 'revoke':
                gateway.active = False; gateway.save(update_fields=['active'])
                audit(request.user, site, 'GATEWAY_REVOKED', gateway.node, {})
                return Response({'status': 'revoked'})
            if action != 'rotate': raise ValidationError('Unsupported action.')
            secret = secrets.token_urlsafe(32)
            gateway.credential_hash = make_password(secret); gateway.credential_version += 1
            gateway.save(update_fields=['credential_hash', 'credential_version'])
        audit(request.user, site, 'GATEWAY_CREDENTIAL', gateway.node, {'version': gateway.credential_version})
        return Response({'gateway_id': gateway.pk, 'node_id': gateway.node_id, 'credential': secret,
            'notice': 'Shown once. Configure the gateway and provision broker authentication securely.'}, status=201)


class CommandsView(APIView):
    @transaction.atomic
    def post(self, request):
        gateway = get_object_or_404(GatewayRegistration.objects.select_related('site'), pk=request.data.get('gateway_id'), active=True)
        enforce(request.user, 'manage_devices', gateway.site)
        kind = request.data.get('kind')
        if kind not in ('PROVISION', 'DIAGNOSTIC'):
            raise ValidationError('Only provisioning and diagnostics are supported.')
        import uuid
        try: operation_id = uuid.UUID(str(request.data.get('operation_id', '')))
        except ValueError: raise ValidationError('A command operation UUID is required.')
        existing = DeviceCommand.objects.filter(pk=operation_id).first()
        if existing:
            if existing.actor_id != request.user.pk or existing.gateway_id != gateway.pk or existing.kind != kind or existing.node_id != request.data.get('node_id'):
                raise ValidationError('Operation ID was already used.')
            return Response({'command_id': str(existing.pk), 'state': existing.state})
        node_id = str(request.data.get('node_id', '')).strip()
        payload = {}
        if kind == 'PROVISION':
            discovery = get_object_or_404(DeviceDiscovery, pk=request.data.get('discovery_id'), gateway=gateway)
            role = request.data.get('role', 'WEARABLE')
            if role not in ('WEARABLE', 'ANCHOR') or not re.fullmatch(r'[A-Za-z0-9_-]{1,23}', node_id):
                raise ValidationError('Use a valid tracking/anchor role and wire-compatible node ID.')
            if Node.objects.filter(pk=node_id).exists() or Node.objects.filter(hardware_id=discovery.hardware_id).exists():
                raise ValidationError('Identity already registered; inspect its existing command.')
            zone = get_object_or_404(Zone, pk=request.data['zone_id'], site=gateway.site, active=True) if request.data.get('zone_id') else None
            if zone and len(zone.code) > 23: raise ValidationError('Zone code exceeds current firmware capacity.')
            node = Node.objects.create(node_id=node_id, hardware_id=discovery.hardware_id,
                site=gateway.site, organisation=gateway.site.organisation, role=role,
                status='OFFLINE', is_simulated=False, installation_zone=zone if role == 'ANCHOR' else None)
            payload = {'role': role, 'zone': zone.code if zone and role == 'ANCHOR' else 'UNASSIGNED'}
        else:
            node = get_object_or_404(Node, pk=node_id, site=gateway.site, archived=False, commissioned=True)
        command = DeviceCommand.objects.create(id=operation_id, gateway=gateway, node=node,
            actor=request.user, kind=kind, payload=payload,
            expires_at=timezone.now() + timedelta(seconds=300 if kind == 'PROVISION' else 30))
        audit(request.user, gateway.site, 'COMMAND_QUEUED', node, {'command_id': str(command.pk), 'kind': kind})
        return Response({'command_id': str(command.pk), 'state': command.state}, status=201)
