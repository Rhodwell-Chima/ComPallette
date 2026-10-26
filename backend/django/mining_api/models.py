import time
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
    RESOLVED = 'RESOLVED', 'Cleared & Closed'


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
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']
        verbose_name = 'Audit Entry'
        verbose_name_plural = 'Audit Log Entries'

    def __str__(self):
        return f"{self.action} by {self.actor} @ {self.timestamp}"
