from django.conf import settings
from django.db import models

class NodeRole(models.TextChoices):
    WEARABLE = 'WEARABLE', 'Wearable Miner Badge'
    ANCHOR = 'ANCHOR', 'Stationary Infrastructure Anchor'
    GATEWAY = 'GATEWAY', 'Surface/Shaft Gateway Bridge'

class NodeStatus(models.TextChoices):
    ONLINE = 'ONLINE', 'Active Online'
    STALE = 'STALE', 'Stale / Missing Heartbeats'
    OFFLINE = 'OFFLINE', 'Communication Lost'

class AlertSeverity(models.TextChoices):
    INFO = 'INFO', 'Informational'
    WARNING = 'WARNING', 'Warning Hazard'
    CRITICAL = 'CRITICAL', 'Critical Emergency'

class AlertStatus(models.TextChoices):
    NEW = 'NEW', 'Unacknowledged Alarm'
    ACKNOWLEDGED = 'ACKNOWLEDGED', 'Under Investigation'
    INVESTIGATING = 'INVESTIGATING', 'Assigned for Investigation'
    RESOLVED = 'RESOLVED', 'Cleared & Closed'

class ProvisioningStatus(models.TextChoices):
    PENDING = 'PENDING', 'Pending Assignment'
    ASSIGNED = 'ASSIGNED', 'Assigned & Dispatched'
    CONFIRMED = 'CONFIRMED', 'Commissioned & Active'


class LocationEvidence(models.TextChoices):
    CONFIRMED = 'CONFIRMED', 'Confirmed direct evidence'
    ESTIMATED = 'ESTIMATED', 'Estimated zone'
    LAST_KNOWN = 'LAST_KNOWN', 'Stale last-known zone'
    UNKNOWN = 'UNKNOWN', 'Unknown or unassigned'


class MembershipRole(models.TextChoices):
    ORG_ADMIN = 'ORG_ADMIN', 'Organisation Administrator'
    SITE_ADMIN = 'SITE_ADMIN', 'Site Administrator'
    OPERATIONS = 'OPERATIONS', 'Operations Controller'
    SAFETY = 'SAFETY', 'Safety Officer'
    TECHNICIAN = 'TECHNICIAN', 'Technician'
    VIEWER = 'VIEWER', 'Read-only Viewer'


class Organisation(models.Model):
    name = models.CharField(max_length=120, unique=True)
    slug = models.SlugField(max_length=140, unique=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Site(models.Model):
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE, related_name='sites')
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=32)
    industry = models.CharField(max_length=40, default='MINING')
    timezone = models.CharField(max_length=64, default='Africa/Lusaka')
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']
        constraints = [models.UniqueConstraint(fields=['organisation', 'code'], name='unique_site_code_per_org')]

    def __str__(self):
        return f'{self.organisation.name} / {self.name}'


class Structure(models.Model):
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='structures')
    name = models.CharField(max_length=120)
    structure_type = models.CharField(max_length=40, default='FACILITY')
    description = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['name']
        constraints = [models.UniqueConstraint(fields=['site', 'name'], name='unique_structure_name_per_site')]


class Level(models.Model):
    structure = models.ForeignKey(Structure, on_delete=models.CASCADE, related_name='levels')
    name = models.CharField(max_length=120)
    sort_order = models.IntegerField(default=0)
    description = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['sort_order', 'name']
        constraints = [models.UniqueConstraint(fields=['structure', 'name'], name='unique_level_name_per_structure')]


class Zone(models.Model):
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='zones')
    level = models.ForeignKey(Level, null=True, blank=True, on_delete=models.SET_NULL, related_name='zones')
    code = models.CharField(max_length=64)
    name = models.CharField(max_length=120)
    zone_type = models.CharField(max_length=40, default='OPERATIONAL')
    description = models.TextField(blank=True, default='')
    is_restricted = models.BooleanField(default=False)
    is_hazardous = models.BooleanField(default=False)
    geometry = models.JSONField(default=dict, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ['code']
        constraints = [models.UniqueConstraint(fields=['site', 'code'], name='unique_zone_code_per_site')]

    def __str__(self):
        return f'{self.site.code} / {self.code}'


class FacilityLayout(models.Model):
    site = models.OneToOneField(Site, on_delete=models.CASCADE, related_name='layout')
    version = models.PositiveIntegerField(default=1)
    geometry = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class SiteMembership(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='compallette_memberships')
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE, related_name='memberships')
    site = models.ForeignKey(Site, null=True, blank=True, on_delete=models.CASCADE, related_name='memberships')
    role = models.CharField(max_length=24, choices=MembershipRole.choices, default=MembershipRole.VIEWER)
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'organisation', 'site'], name='unique_user_organisation_site_membership')]


class Personnel(models.Model):
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE, related_name='personnel')
    site = models.ForeignKey(Site, null=True, blank=True, on_delete=models.SET_NULL, related_name='personnel')
    identifier = models.CharField(max_length=32, unique=True)
    display_name = models.CharField(max_length=120)
    team = models.CharField(max_length=80, blank=True, default='')
    employment_status = models.CharField(max_length=24, default='ACTIVE')
    assigned_node = models.OneToOneField('Node', null=True, blank=True, on_delete=models.SET_NULL, related_name='assigned_person')

    class Meta:
        ordering = ['display_name', 'identifier']


class Asset(models.Model):
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE, related_name='assets')
    site = models.ForeignKey(Site, null=True, blank=True, on_delete=models.SET_NULL, related_name='assets')
    identifier = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=120)
    asset_type = models.CharField(max_length=80, blank=True, default='')
    operational_status = models.CharField(max_length=24, default='ACTIVE')
    assigned_node = models.OneToOneField('Node', null=True, blank=True, on_delete=models.SET_NULL, related_name='assigned_asset')

    class Meta:
        ordering = ['name', 'identifier']


class DeviceCapability(models.Model):
    node = models.ForeignKey('Node', on_delete=models.CASCADE, related_name='capabilities')
    measurement_key = models.CharField(max_length=48)
    display_name = models.CharField(max_length=80)
    unit = models.CharField(max_length=24)
    warning_threshold = models.FloatField(null=True, blank=True)
    critical_threshold = models.FloatField(null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['node', 'measurement_key'], name='unique_node_measurement_capability')]


class MeasurementReading(models.Model):
    node = models.ForeignKey('Node', on_delete=models.CASCADE, related_name='measurements')
    capability = models.ForeignKey(DeviceCapability, null=True, blank=True, on_delete=models.SET_NULL, related_name='readings')
    measurement_key = models.CharField(max_length=48)
    value = models.FloatField()
    unit = models.CharField(max_length=24)
    source_seq = models.PositiveIntegerField(default=0)
    received_at = models.BigIntegerField()
    zone = models.CharField(max_length=64, blank=True, default='')

    class Meta:
        ordering = ['-received_at']
        constraints = [models.UniqueConstraint(fields=['node', 'measurement_key', 'source_seq'], name='unique_measurement_source_event')]
        indexes = [models.Index(fields=['measurement_key', '-received_at'])]


class Node(models.Model):
    """Represents any tracked physical or simulated node in the mine network."""
    node_id = models.CharField(max_length=32, primary_key=True)
    role = models.CharField(max_length=24, choices=NodeRole.choices, default=NodeRole.WEARABLE)
    current_zone = models.CharField(max_length=64, default='UNASSIGNED')
    last_seen_ts = models.BigIntegerField(default=0)
    last_seq = models.PositiveIntegerField(default=0)
    battery_v = models.FloatField(default=0.0)
    free_heap = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=16, choices=NodeStatus.choices, default=NodeStatus.ONLINE)
    is_simulated = models.BooleanField(default=True)
    sensor_ok = models.BooleanField(default=True)
    latest_co = models.FloatField(default=0.0)
    latest_temp = models.FloatField(default=0.0)
    latest_hum = models.FloatField(default=0.0)
    organisation = models.ForeignKey(Organisation, null=True, blank=True, on_delete=models.SET_NULL, related_name='nodes')
    site = models.ForeignKey(Site, null=True, blank=True, on_delete=models.SET_NULL, related_name='nodes')
    zone_ref = models.ForeignKey(Zone, null=True, blank=True, on_delete=models.SET_NULL, related_name='nodes')
    location_evidence = models.CharField(max_length=16, choices=LocationEvidence.choices, default=LocationEvidence.UNKNOWN)
    location_observed_at = models.BigIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['node_id']
        verbose_name = 'Subterranean Node'
        verbose_name_plural = 'Subterranean Nodes'

    def __str__(self):
        return f"{self.node_id} ({self.role}) @ {self.current_zone}"


class TelemetryRecord(models.Model):
    """Time-series sensor telemetry received from underground wearable tags."""
    node = models.ForeignKey(Node, on_delete=models.CASCADE, related_name='telemetry')
    seq = models.PositiveIntegerField()
    zone = models.CharField(max_length=64, blank=True, default='')
    co_ppm = models.FloatField(default=0.0)
    temp_c = models.FloatField(default=0.0)
    humidity_pct = models.FloatField(default=0.0)
    fall_detected = models.BooleanField(default=False)
    battery_v = models.FloatField(default=0.0)
    is_simulated = models.BooleanField(default=True)
    sensor_ok = models.BooleanField(default=True)
    uptime_ms = models.BigIntegerField(default=0)
    received_at = models.BigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('node', 'seq')
        ordering = ['-received_at']
        indexes = [
            models.Index(fields=['node', '-received_at']),
        ]
        verbose_name = 'Telemetry Record'
        verbose_name_plural = 'Telemetry Records'

    def __str__(self):
        return f"{self.node_id} #{self.seq} - CO {self.co_ppm} ppm"


class SafetyAlert(models.Model):
    """Safety hazard alarms with an auditable acknowledgement and resolution lifecycle."""
    node = models.ForeignKey(Node, on_delete=models.CASCADE, related_name='alerts')
    zone = models.CharField(max_length=64, blank=True, default='')
    severity = models.CharField(max_length=16, choices=AlertSeverity.choices, default=AlertSeverity.WARNING)
    alert_code = models.CharField(max_length=32)
    details = models.TextField(blank=True, default='')
    trigger_value = models.FloatField(default=0.0)
    status = models.CharField(max_length=16, choices=AlertStatus.choices, default=AlertStatus.NEW)
    seq = models.PositiveIntegerField(default=0)
    created_at = models.BigIntegerField()
    acknowledged_at = models.BigIntegerField(null=True, blank=True)
    acknowledged_by = models.CharField(max_length=64, blank=True, default='')
    resolved_at = models.BigIntegerField(null=True, blank=True)
    resolved_by = models.CharField(max_length=64, blank=True, default='')
    resolution_notes = models.TextField(blank=True, default='')
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='assigned_safety_alerts')
    assigned_at = models.BigIntegerField(null=True, blank=True)
    investigation_notes = models.TextField(blank=True, default='')

    class Meta:
        unique_together = ('node', 'seq', 'alert_code')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'severity']),
        ]
        verbose_name = 'Safety Alert'
        verbose_name_plural = 'Safety Alerts'

    def __str__(self):
        return f"[{self.severity}] {self.alert_code} - {self.node_id} ({self.status})"


class AuditEntry(models.Model):
    """Chronological operations ledger capturing officer actions and system events."""
    timestamp = models.BigIntegerField()
    actor = models.CharField(max_length=64)
    action = models.CharField(max_length=32)
    details = models.TextField(blank=True, default='')
    site = models.ForeignKey(Site, null=True, blank=True, on_delete=models.SET_NULL, related_name='audit_entries')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']
        verbose_name = 'Audit Entry'
        verbose_name_plural = 'Audit Log Entries'

    def __str__(self):
        return f"{self.action} by {self.actor} @ {self.timestamp}"


class ProvisioningRequest(models.Model):
    """Tracks uncommissioned physical ESP32 nodes discovered via Option 1 mesh beacons."""
    chip_id = models.CharField(max_length=16, primary_key=True)
    chip_mac = models.CharField(max_length=24, blank=True, default='')
    mesh_node_id = models.BigIntegerField(default=0)
    fw_version = models.CharField(max_length=16, default='1.1.0')
    battery_v = models.FloatField(default=0.0)
    mq_healthy = models.BooleanField(default=False)
    mpu_healthy = models.BooleanField(default=False)
    status = models.CharField(max_length=16, choices=ProvisioningStatus.choices, default=ProvisioningStatus.PENDING)

    # Assigned fields once dispatcher commissions the node
    assigned_id = models.CharField(max_length=32, blank=True, default='')
    assigned_role = models.CharField(max_length=24, choices=NodeRole.choices, default=NodeRole.WEARABLE)
    assigned_zone = models.CharField(max_length=64, blank=True, default='')
    assigned_by = models.CharField(max_length=64, blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        verbose_name = 'Provisioning Request'
        verbose_name_plural = 'Provisioning Requests'

    def __str__(self):
        return f"Chip #{self.chip_id} ({self.status}) -> {self.assigned_id or 'Unassigned'}"
