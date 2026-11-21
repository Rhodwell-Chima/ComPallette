"""Relationships and event provenance for the general platform."""
import uuid
from django.conf import settings
from django.db import models
from django.db.models import Q, F


class DeviceAssignment(models.Model):
    node = models.ForeignKey('Node', on_delete=models.PROTECT, related_name='assignments')
    personnel = models.ForeignKey('Personnel', null=True, blank=True, on_delete=models.PROTECT, related_name='device_assignments')
    asset = models.ForeignKey('Asset', null=True, blank=True, on_delete=models.PROTECT, related_name='device_assignments')
    site = models.ForeignKey('Site', on_delete=models.PROTECT)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    started_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    ended_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT, related_name='+')
    reason = models.TextField(blank=True)
    end_reason = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=(Q(personnel__isnull=False, asset__isnull=True) | Q(personnel__isnull=True, asset__isnull=False)), name='assignment_exactly_one_owner'),
            models.UniqueConstraint(fields=['node'], condition=Q(ended_at__isnull=True), name='one_active_owner_per_node'),
            models.UniqueConstraint(fields=['personnel'], condition=Q(ended_at__isnull=True, personnel__isnull=False), name='one_active_node_per_person'),
            models.UniqueConstraint(fields=['asset'], condition=Q(ended_at__isnull=True, asset__isnull=False), name='one_active_node_per_asset'),
            models.CheckConstraint(condition=Q(ended_at__isnull=True) | Q(ended_at__gte=F('started_at')), name='assignment_valid_interval'),
        ]


class AssetCustody(models.Model):
    asset = models.ForeignKey('Asset', on_delete=models.PROTECT, related_name='custody_history')
    personnel = models.ForeignKey('Personnel', on_delete=models.PROTECT, related_name='custody_history')
    site = models.ForeignKey('Site', on_delete=models.PROTECT)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    started_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    ended_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT, related_name='+')
    reason = models.TextField(blank=True)
    end_reason = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['asset'], condition=Q(ended_at__isnull=True), name='one_current_custodian'),
            models.CheckConstraint(condition=Q(ended_at__isnull=True) | Q(ended_at__gte=F('started_at')), name='custody_valid_interval'),
        ]


class PlatformOperation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    request_digest = models.CharField(max_length=64)
    result = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)


class SiteTransfer(models.Model):
    entity_type = models.CharField(max_length=16)
    entity_id = models.CharField(max_length=64)
    source = models.ForeignKey('Site', on_delete=models.PROTECT, related_name='+')
    destination = models.ForeignKey('Site', on_delete=models.PROTECT, related_name='+')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    reason = models.TextField()
    closed_relationships = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)


class GatewayRegistration(models.Model):
    node = models.OneToOneField('Node', on_delete=models.PROTECT, related_name='gateway_registration')
    site = models.ForeignKey('Site', on_delete=models.PROTECT)
    active = models.BooleanField(default=True)
    credential_hash = models.CharField(max_length=256)
    credential_version = models.PositiveIntegerField(default=1)
    credentials_installed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)


class DeviceDiscovery(models.Model):
    gateway = models.ForeignKey(GatewayRegistration, on_delete=models.PROTECT)
    hardware_id = models.CharField(max_length=32)
    sender_id = models.CharField(max_length=32)
    payload = models.JSONField(default=dict)
    version = models.PositiveIntegerField(default=1)
    first_seen = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(auto_now=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=['gateway', 'hardware_id'], name='gateway_hardware_discovery')]


class IngestedEvent(models.Model):
    node = models.ForeignKey('Node', on_delete=models.PROTECT, related_name='events')
    site = models.ForeignKey('Site', on_delete=models.PROTECT)
    gateway = models.ForeignKey(GatewayRegistration, on_delete=models.PROTECT)
    event_type = models.CharField(max_length=24)
    sequence = models.PositiveIntegerField()
    received_at = models.DateTimeField(auto_now_add=True)
    assignment_at_receipt = models.ForeignKey(DeviceAssignment, null=True, on_delete=models.PROTECT)
    capture_assignment = models.ForeignKey(DeviceAssignment, null=True, on_delete=models.PROTECT, related_name='+')
    payload = models.JSONField()
    class Meta:
        constraints = [models.UniqueConstraint(fields=['node', 'event_type', 'sequence'], name='unique_transport_independent_event')]
        indexes = [models.Index(fields=['site', '-received_at'])]


class LocationObservation(models.Model):
    node = models.ForeignKey('Node', on_delete=models.PROTECT, related_name='location_observations')
    site = models.ForeignKey('Site', on_delete=models.PROTECT)
    zone = models.ForeignKey('Zone', null=True, on_delete=models.PROTECT)
    event = models.OneToOneField(IngestedEvent, on_delete=models.PROTECT)
    source = models.CharField(max_length=32, default='LEGACY_REPORTED')
    quality = models.CharField(max_length=16, default='UNKNOWN')
    captured_at = models.DateTimeField(null=True)
    received_at = models.DateTimeField(auto_now_add=True)
    simulated = models.BooleanField(default=False)
    reported_zone = models.CharField(max_length=64, blank=True)


class DeviceCommand(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    gateway = models.ForeignKey(GatewayRegistration, on_delete=models.PROTECT, related_name='commands')
    node = models.ForeignKey('Node', on_delete=models.PROTECT, related_name='commands')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    kind = models.CharField(max_length=16, choices=[('PROVISION', 'Provision'), ('DIAGNOSTIC', 'Diagnostic')])
    state = models.CharField(max_length=24, default='QUEUED')
    payload = models.JSONField(default=dict)
    request_digest = models.CharField(max_length=64, default='')
    result = models.JSONField(default=dict)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True)
    attempts = models.PositiveIntegerField(default=0)


class QuarantinedEvent(models.Model):
    """Durable unknown-device traffic, never included in operational summaries."""
    gateway = models.ForeignKey(GatewayRegistration, on_delete=models.PROTECT)
    site = models.ForeignKey('Site', on_delete=models.PROTECT)
    installation_id = models.UUIDField()
    sender_id = models.CharField(max_length=32)
    event_type = models.CharField(max_length=24)
    sequence = models.PositiveIntegerField()
    payload = models.JSONField()
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['gateway', 'installation_id', 'sender_id', 'event_type', 'sequence'], name='unique_quarantined_delivery')]
