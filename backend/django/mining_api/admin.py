from django.contrib import admin
from .access import operator_capabilities, permitted_sites
from .models import Node, TelemetryRecord, SafetyAlert, AuditEntry


class OperationalReadOnlyAdmin(admin.ModelAdmin):
    """The admin is an inspection surface, never a second mutation API."""

    actions = None
    required_capability = 'view'

    def get_queryset(self, request):
        sites = permitted_sites(request.user)
        if self.required_capability != 'view':
            sites = sites.filter(pk__in=[site.pk for site in sites
                if self.required_capability in operator_capabilities(request.user, site)])
        return super().get_queryset(request).filter(site__in=sites)

    def has_view_permission(self, request, obj=None):
        if not request.user.is_active or not request.user.is_staff:
            return False
        if obj is not None:
            return obj.site_id is not None and self.required_capability in operator_capabilities(request.user, obj.site)
        return any(self.required_capability in operator_capabilities(request.user, site)
                   for site in permitted_sites(request.user))

    def has_module_permission(self, request):
        return self.has_view_permission(request)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Node)
class NodeAdmin(OperationalReadOnlyAdmin):
    list_display = ('node_id', 'role', 'current_zone', 'status', 'latest_co', 'battery_v', 'last_seen_ts')
    list_filter = ('role', 'status', 'current_zone')
    search_fields = ('node_id', 'current_zone')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(TelemetryRecord)
class TelemetryRecordAdmin(OperationalReadOnlyAdmin):
    list_display = ('node', 'seq', 'zone', 'co_ppm', 'temp_c', 'humidity_pct', 'fall_detected', 'battery_v', 'received_at')
    list_filter = ('fall_detected', 'zone', 'is_simulated')
    search_fields = ('node__node_id', 'zone')
    readonly_fields = ('created_at',)


@admin.register(SafetyAlert)
class SafetyAlertAdmin(OperationalReadOnlyAdmin):
    list_display = ('id', 'node', 'severity', 'alert_code', 'zone', 'status', 'created_at', 'acknowledged_by', 'resolved_by')
    list_filter = ('severity', 'status', 'alert_code')
    search_fields = ('node__node_id', 'alert_code', 'zone', 'details')
    readonly_fields = ('created_at', 'acknowledged_at', 'resolved_at')


@admin.register(AuditEntry)
class AuditEntryAdmin(OperationalReadOnlyAdmin):
    required_capability = 'view_audit'
    list_display = ('timestamp', 'actor', 'action', 'details', 'created_at')
    list_filter = ('action',)
    search_fields = ('actor', 'action', 'details')
    readonly_fields = ('created_at',)
