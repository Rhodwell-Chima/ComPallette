from django.contrib import admin
from .models import Node, TelemetryRecord, SafetyAlert, AuditEntry

@admin.register(Node)
class NodeAdmin(admin.ModelAdmin):
    list_display = ('node_id', 'role', 'current_zone', 'status', 'latest_co', 'battery_v', 'last_seen_ts')
    list_filter = ('role', 'status', 'current_zone')
    search_fields = ('node_id', 'current_zone')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(TelemetryRecord)
class TelemetryRecordAdmin(admin.ModelAdmin):
    list_display = ('node', 'seq', 'zone', 'co_ppm', 'temp_c', 'humidity_pct', 'fall_detected', 'battery_v', 'received_at')
    list_filter = ('fall_detected', 'zone', 'is_simulated')
    search_fields = ('node__node_id', 'zone')
    readonly_fields = ('created_at',)


@admin.register(SafetyAlert)
class SafetyAlertAdmin(admin.ModelAdmin):
    list_display = ('id', 'node', 'severity', 'alert_code', 'zone', 'status', 'created_at', 'acknowledged_by', 'resolved_by')
    list_filter = ('severity', 'status', 'alert_code')
    search_fields = ('node__node_id', 'alert_code', 'zone', 'details')
    readonly_fields = ('created_at', 'acknowledged_at', 'resolved_at')


@admin.register(AuditEntry)
class AuditEntryAdmin(admin.ModelAdmin):
    list_display = ('timestamp', 'actor', 'action', 'details', 'created_at')
    list_filter = ('action',)
    search_fields = ('actor', 'action', 'details')
    readonly_fields = ('created_at',)
