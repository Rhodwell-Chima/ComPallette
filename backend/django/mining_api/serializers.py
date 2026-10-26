from rest_framework import serializers
from .models import Node, TelemetryRecord, SafetyAlert, AuditEntry, ProvisioningRequest

class NodeSerializer(serializers.ModelSerializer):
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

    class Meta:
        model = SafetyAlert
        fields = [
            'id', 'node_id', 'zone', 'severity', 'alert_code', 'details',
            'trigger_value', 'status', 'seq', 'created_at',
            'acknowledged_at', 'acknowledged_by',
            'resolved_at', 'resolved_by', 'resolution_notes'
        ]


class AuditEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditEntry
        fields = ['id', 'timestamp', 'actor', 'action', 'details']


class ProvisioningRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProvisioningRequest
        fields = '__all__'
