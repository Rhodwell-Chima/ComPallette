from rest_framework import serializers
from .models import (
    Asset, AuditEntry, DeviceCapability, FacilityLayout, Level, MeasurementReading,
    Node, Organisation, Personnel, ProvisioningRequest, SafetyAlert, Site, TelemetryRecord,
    Structure, Zone, SiteMembership,
)

class NodeSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source='site.name', read_only=True)
    zone_name = serializers.CharField(source='zone_ref.name', read_only=True)
    assigned_person = serializers.CharField(source='assigned_person.display_name', read_only=True)
    assigned_asset = serializers.CharField(source='assigned_asset.name', read_only=True)

    class Meta:
        model = Node
        fields = '__all__'


class TelemetryRecordSerializer(serializers.ModelSerializer):
    node_id = serializers.CharField(source='node.node_id', read_only=True)

    class Meta:
        model = TelemetryRecord
        fields = [
            'id', 'node_id', 'seq', 'zone', 'co_ppm', 'temp_c',
            'humidity_pct', 'fall_detected', 'battery_v',
            'is_simulated', 'sensor_ok', 'uptime_ms', 'received_at'
        ]


class SafetyAlertSerializer(serializers.ModelSerializer):
    node_id = serializers.CharField(source='node.node_id', read_only=True)
    assigned_to_username = serializers.CharField(source='assigned_to.username', read_only=True)

    class Meta:
        model = SafetyAlert
        fields = [
            'id', 'node_id', 'zone', 'severity', 'alert_code', 'details',
            'trigger_value', 'status', 'seq', 'created_at',
            'acknowledged_at', 'acknowledged_by',
            'resolved_at', 'resolved_by', 'resolution_notes',
            'assigned_to', 'assigned_to_username', 'assigned_at', 'investigation_notes',
        ]


class AuditEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditEntry
        fields = ['id', 'timestamp', 'actor', 'action', 'details', 'site']


class ProvisioningRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProvisioningRequest
        fields = '__all__'


class OrganisationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organisation
        fields = ['id', 'name', 'slug', 'active']


class SiteSerializer(serializers.ModelSerializer):
    organisation_name = serializers.CharField(source='organisation.name', read_only=True)

    class Meta:
        model = Site
        fields = ['id', 'organisation', 'organisation_name', 'name', 'code', 'industry', 'timezone', 'active']


class StructureSerializer(serializers.ModelSerializer):
    class Meta:
        model = Structure
        fields = ['id', 'site', 'name', 'structure_type', 'description']


class LevelSerializer(serializers.ModelSerializer):
    class Meta:
        model = Level
        fields = ['id', 'structure', 'name', 'sort_order', 'description']


class ZoneSerializer(serializers.ModelSerializer):
    level_name = serializers.CharField(source='level.name', read_only=True)

    class Meta:
        model = Zone
        fields = ['id', 'site', 'level', 'level_name', 'code', 'name', 'zone_type', 'description', 'is_restricted', 'is_hazardous', 'geometry', 'active']


class FacilityLayoutSerializer(serializers.ModelSerializer):
    class Meta:
        model = FacilityLayout
        fields = ['site', 'version', 'geometry', 'updated_at']


class PersonnelSerializer(serializers.ModelSerializer):
    node_id = serializers.CharField(source='assigned_node.node_id', read_only=True)
    current_zone = serializers.CharField(source='assigned_node.current_zone', read_only=True)
    location_evidence = serializers.CharField(source='assigned_node.location_evidence', read_only=True)
    location_observed_at = serializers.IntegerField(source='assigned_node.location_observed_at', read_only=True)
    node_status = serializers.CharField(source='assigned_node.status', read_only=True)

    class Meta:
        model = Personnel
        fields = ['id', 'organisation', 'site', 'identifier', 'display_name', 'team', 'employment_status', 'assigned_node', 'node_id', 'current_zone', 'location_evidence', 'location_observed_at', 'node_status']


class AssetSerializer(serializers.ModelSerializer):
    node_id = serializers.CharField(source='assigned_node.node_id', read_only=True)
    current_zone = serializers.CharField(source='assigned_node.current_zone', read_only=True)
    location_evidence = serializers.CharField(source='assigned_node.location_evidence', read_only=True)
    location_observed_at = serializers.IntegerField(source='assigned_node.location_observed_at', read_only=True)
    node_status = serializers.CharField(source='assigned_node.status', read_only=True)

    class Meta:
        model = Asset
        fields = ['id', 'organisation', 'site', 'identifier', 'name', 'asset_type', 'operational_status', 'assigned_node', 'node_id', 'current_zone', 'location_evidence', 'location_observed_at', 'node_status']


class DeviceCapabilitySerializer(serializers.ModelSerializer):
    class Meta:
        model = DeviceCapability
        fields = ['id', 'node', 'measurement_key', 'display_name', 'unit', 'warning_threshold', 'critical_threshold', 'active']


class MeasurementReadingSerializer(serializers.ModelSerializer):
    node_id = serializers.CharField(source='node.node_id', read_only=True)

    class Meta:
        model = MeasurementReading
        fields = ['id', 'node', 'node_id', 'capability', 'measurement_key', 'value', 'unit', 'source_seq', 'received_at', 'zone']


class SiteMembershipSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    site_name = serializers.CharField(source='site.name', read_only=True)
    organisation_name = serializers.CharField(source='organisation.name', read_only=True)

    class Meta:
        model = SiteMembership
        fields = ['id', 'user', 'username', 'organisation', 'organisation_name', 'site', 'site_name', 'role', 'active']
