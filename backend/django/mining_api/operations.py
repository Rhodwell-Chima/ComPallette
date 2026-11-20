"""Atomic relationship operations. All callers, including admin tools, use these."""
import hashlib
import json
import uuid
from django.db import transaction, IntegrityError
from django.core.exceptions import ValidationError as ModelValidationError
from django.db.models import Q, F
from django.utils import timezone
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, ValidationError
from .access import enforce
from .models import (Node, Personnel, Asset, Site, DeviceAssignment, AssetCustody,
                     PlatformOperation, SiteTransfer, AuditEntry)


class Conflict(APIException):
    status_code = 409
    default_detail = 'The record changed. Refresh before retrying.'


ENTITIES = {'personnel': Personnel, 'assets': Asset, 'devices': Node}


def audit(user, site, action, entity, metadata):
    AuditEntry.objects.create(timestamp=int(timezone.now().timestamp() * 1000),
        actor=user.get_username(), actor_user=user, action=action, site=site,
        entity_type=entity._meta.model_name, entity_id=str(entity.pk),
        details=action.replace('_', ' ').capitalize(), metadata=metadata)


def relationships(entity):
    key = 'node' if isinstance(entity, Node) else 'personnel' if isinstance(entity, Personnel) else 'asset'
    assignments = DeviceAssignment.objects.filter(**{key: entity}, ended_at__isnull=True)
    custody = AssetCustody.objects.none() if isinstance(entity, Node) else AssetCustody.objects.filter(**{key: entity}, ended_at__isnull=True)
    return assignments, custody


def preview_transfer(entity, destination):
    if destination.organisation_id != entity.organisation_id:
        raise ValidationError('Cross-organisation transfers are not supported.')
    if destination.pk == entity.site_id:
        raise ValidationError('Select a different destination site.')
    assignments, custody = relationships(entity)
    return {'assignment_ids': list(assignments.values_list('pk', flat=True)),
            'custody_ids': list(custody.values_list('pk', flat=True))}


def close_assignment(assignment, user, reason):
    assignment.ended_at = timezone.now()
    assignment.ended_by = user
    assignment.end_reason = reason
    assignment.save(update_fields=['ended_at', 'ended_by', 'end_reason'])
    owner = assignment.personnel or assignment.asset
    type(owner).objects.filter(pk=owner.pk).update(assigned_node=None, version=F('version') + 1)
    Node.objects.filter(pk=assignment.node_id).update(version=F('version') + 1)


def close_custody(custody, user, reason):
    custody.ended_at = timezone.now()
    custody.ended_by = user
    custody.end_reason = reason
    custody.save(update_fields=['ended_at', 'ended_by', 'end_reason'])
    Asset.objects.filter(pk=custody.asset_id).update(version=F('version') + 1)
    Personnel.objects.filter(pk=custody.personnel_id).update(version=F('version') + 1)


def mutate(user, kind, pk, payload):
    try:
        return _mutate(user, kind, pk, payload)
    except IntegrityError as exc:
        raise Conflict('A competing relationship change was saved. Refresh before retrying.') from exc
    except ModelValidationError as exc:
        raise ValidationError(exc.message_dict if hasattr(exc, 'message_dict') else exc.messages) from exc


@transaction.atomic
def _mutate(user, kind, pk, payload):
    if kind not in ENTITIES:
        raise ValidationError('Unknown entity type.')
    try:
        operation_id = uuid.UUID(str(payload.get('operation_id', '')))
    except ValueError:
        raise ValidationError({'operation_id': 'A UUID is required.'})
    # Lock the actor to serialize same-actor retries before reserving the operation ID.
    type(user).objects.select_for_update().get(pk=user.pk)
    digest = hashlib.sha256(json.dumps([kind, str(pk), payload], sort_keys=True).encode()).hexdigest()
    prior = PlatformOperation.objects.filter(pk=operation_id).first()
    if prior:
        if prior.actor_id != user.pk or prior.request_digest != digest:
            raise Conflict('Operation ID was already used for a different request.')
        return prior.result
    # A per-site lock also serializes owner/node lock acquisition and transfers.
    current = get_object_or_404(ENTITIES[kind], pk=pk)
    site_ids = [current.site_id]
    action = payload.get('action')
    if action == 'transfer':
        site_ids.append(payload.get('destination_site'))
    list(Site.objects.select_for_update().filter(pk__in=[x for x in site_ids if x]).order_by('pk'))
    entity = ENTITIES[kind].objects.select_for_update().get(pk=pk)
    if entity.site_id != current.site_id:
        raise Conflict('This record was transferred. Reload before changing it.')
    if entity.site_id is None:
        raise ValidationError('The record must belong to a site before changing relationships.')
    enforce(user, 'manage_devices' if kind == 'devices' else 'manage_assets', entity.site)
    if entity.archived:
        raise Conflict('Archived records cannot be changed.')
    if payload.get('expected_version') != entity.version:
        raise Conflict()
    reason = str(payload.get('reason', '')).strip()
    if action in ('release', 'return', 'transfer', 'archive') and not reason:
        raise ValidationError({'reason': 'A reason is required.'})
    if action == 'assign':
        if kind == 'devices':
            raise ValidationError('Assign from a personnel or asset record.')
        node = get_object_or_404(Node.objects.select_for_update(), pk=payload.get('node_id'))
        if node.site_id != entity.site_id or node.organisation_id != entity.organisation_id:
            raise ValidationError('The device must belong to the same site and organisation.')
        if node.archived or not node.commissioned or node.role != 'WEARABLE':
            raise ValidationError('Select a commissioned, active tracking device.')
        owner_key = 'personnel' if kind == 'personnel' else 'asset'
        if DeviceAssignment.objects.filter(Q(node=node) | Q(**{owner_key: entity}), ended_at__isnull=True).exists():
            raise Conflict('Return the current assignment before assigning this device.')
        DeviceAssignment.objects.create(node=node, site=entity.site, started_by=user, reason=reason, **{owner_key: entity})
        entity.assigned_node = node
        Node.objects.filter(pk=node.pk).update(version=F('version') + 1)
    elif action == 'release':
        assignments, _ = relationships(entity)
        assignment = assignments.first()
        if not assignment or assignment.pk != payload.get('relationship_id'):
            raise Conflict('The selected assignment is no longer current.')
        close_assignment(assignment, user, reason)
        entity.refresh_from_db()
    elif action == 'custody':
        if kind != 'assets':
            raise ValidationError('Custody is managed from an asset.')
        person = get_object_or_404(Personnel.objects.select_for_update(), pk=payload.get('personnel_id'), archived=False)
        if person.site_id != entity.site_id or person.organisation_id != entity.organisation_id:
            raise ValidationError('The custodian must belong to the same site.')
        if AssetCustody.objects.filter(asset=entity, ended_at__isnull=True).exists():
            raise Conflict('Return the current custody before issuing the asset.')
        AssetCustody.objects.create(asset=entity, personnel=person, site=entity.site, started_by=user, reason=reason)
        Personnel.objects.filter(pk=person.pk).update(version=F('version') + 1)
    elif action == 'return':
        if kind != 'assets':
            raise ValidationError('Return custody from an asset.')
        custody = entity.custody_history.filter(ended_at__isnull=True).first()
        if not custody or custody.pk != payload.get('relationship_id'):
            raise Conflict('The selected custody is no longer current.')
        close_custody(custody, user, reason)
        entity.refresh_from_db()
    elif action in ('transfer', 'archive'):
        destination = None
        if action == 'transfer':
            destination = get_object_or_404(Site, pk=payload.get('destination_site'))
            enforce(user, 'manage_devices' if kind == 'devices' else 'manage_assets', destination)
            affected = preview_transfer(entity, destination)
        else:
            assignments, custody = relationships(entity)
            affected = {'assignment_ids': list(assignments.values_list('pk', flat=True)), 'custody_ids': list(custody.values_list('pk', flat=True))}
        if affected != payload.get('confirmed_relationships'):
            raise Conflict('Preview the affected relationships again before confirming.')
        for item in DeviceAssignment.objects.filter(pk__in=affected['assignment_ids']):
            close_assignment(item, user, reason)
        for item in AssetCustody.objects.filter(pk__in=affected['custody_ids']):
            close_custody(item, user, reason)
        entity.refresh_from_db()
        if destination:
            if isinstance(entity, Node) and entity.role == 'GATEWAY':
                raise ValidationError('Gateway transfers require decommissioning and credential replacement.')
            SiteTransfer.objects.create(entity_type=kind, entity_id=str(entity.pk), source=entity.site,
                destination=destination, actor=user, reason=reason, closed_relationships=affected)
            entity.site = destination
            if isinstance(entity, Node):
                entity.zone_ref = None
                entity.installation_zone = None
                entity.current_zone = 'UNASSIGNED'
                entity.location_evidence = 'UNKNOWN'
                entity.location_observed_at = 0
        else:
            entity.archived = True
    elif action == 'edit':
        allowed = {'personnel': ['display_name', 'team', 'employment_status'], 'assets': ['name', 'asset_type', 'operational_status'], 'devices': []}[kind]
        changes = payload.get('changes', {})
        if not isinstance(changes, dict) or set(changes) - set(allowed):
            raise ValidationError('Unsupported edit fields.')
        for field, value in changes.items():
            if not isinstance(value, str) or not value.strip():
                raise ValidationError({field: 'A non-empty string is required.'})
            setattr(entity, field, value.strip())
        entity.full_clean()
    elif action == 'link_user':
        if kind != 'personnel':
            raise ValidationError('Accounts link to personnel only.')
        enforce(user, 'manage_users', entity.site)
        from django.contrib.auth import get_user_model
        linked = get_object_or_404(get_user_model(), pk=payload.get('user_id')) if payload.get('user_id') else None
        if linked:
            from .access import permitted_sites
            if not permitted_sites(linked).filter(pk=entity.site_id).exists():
                raise ValidationError('The account must have access to this site.')
            if Personnel.objects.filter(organisation=entity.organisation, user=linked).exclude(pk=entity.pk).exists():
                raise Conflict('This account is already linked in this organisation.')
        entity.user = linked
    else:
        raise ValidationError('Unsupported action.')
    entity.version += 1
    entity.save()
    result = {'id': entity.pk, 'version': entity.version, 'action': action, 'status': 'ok'}
    audit(user, entity.site, action.upper(), entity, {'reason': reason, 'operation_id': str(operation_id)})
    PlatformOperation.objects.create(id=operation_id, actor=user, request_digest=digest, result=result)
    return result
