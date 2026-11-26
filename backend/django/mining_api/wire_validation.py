from rest_framework import serializers


class AnchorSerializer(serializers.Serializer):
    id = serializers.CharField(max_length=32, required=False, allow_blank=True)
    zone = serializers.CharField(max_length=64, required=False, allow_blank=True)
    state = serializers.ChoiceField(
        choices=('UNKNOWN', 'CURRENT', 'CONFIRMED', 'TRANSITIONING', 'AMBIGUOUS', 'LAST_KNOWN', 'ESTIMATED'),
        required=False
    )
    hop = serializers.IntegerField(required=False)
    rssi = serializers.IntegerField(required=False)


class EnvelopeSerializer(serializers.Serializer):
    ver = serializers.IntegerField(min_value=1, max_value=2)
    type = serializers.CharField(max_length=16)
    seq = serializers.IntegerField(min_value=1, max_value=2_147_483_647)
    sender = serializers.CharField(max_length=32, allow_blank=False)
    role = serializers.ChoiceField(choices=('WEARABLE', 'ANCHOR', 'GATEWAY', 'UNASSIGNED'))
    zone = serializers.CharField(max_length=64, allow_blank=False)
    uptime = serializers.IntegerField(min_value=0)
    anchor = AnchorSerializer(required=False, allow_null=True)
    payload = serializers.DictField()


def validate_envelope(data, expected_type):
    if not isinstance(data, dict):
        return None, {"error": "Payload must be a JSON object"}
    serializer = EnvelopeSerializer(data=data)
    if not serializer.is_valid():
        return None, {"error": "Invalid wire envelope", "details": serializer.errors}
    normalized = serializer.validated_data
    if normalized['type'] != expected_type:
        return None, {"error": f"Expected message type {expected_type}"}
    return normalized, None


class TelemetryPayloadSerializer(serializers.Serializer):
    co = serializers.FloatField(min_value=0, max_value=10000, required=False)
    co_ppm = serializers.FloatField(min_value=0, max_value=10000, required=False)
    temp = serializers.FloatField(min_value=-50, max_value=100, required=False)
    temp_c = serializers.FloatField(min_value=-50, max_value=100, required=False)
    hum = serializers.FloatField(min_value=0, max_value=100, required=False)
    humidity_pct = serializers.FloatField(min_value=0, max_value=100, required=False)
    press = serializers.FloatField(min_value=0, max_value=200000, required=False)
    pressure_pa = serializers.FloatField(min_value=0, max_value=200000, required=False)
    gas_res = serializers.FloatField(min_value=0, max_value=100000000, required=False)
    gas_resistance_ohm = serializers.FloatField(min_value=0, max_value=100000000, required=False)
    fall = serializers.BooleanField(required=False)
    fall_detected = serializers.BooleanField(required=False)
    batt = serializers.FloatField(min_value=0, max_value=10, required=False)
    battery_v = serializers.FloatField(min_value=0, max_value=10, required=False)
    battery_pct = serializers.FloatField(min_value=0, max_value=100, required=False)
    gas_valid = serializers.BooleanField(required=False)
    bme_gas_valid = serializers.BooleanField(required=False)
    warming = serializers.BooleanField(required=False)
    sim = serializers.BooleanField(required=False)
    is_simulated = serializers.BooleanField(required=False)
    ok = serializers.BooleanField(required=False)
    sensor_ok = serializers.BooleanField(required=False)
    active_alarms = serializers.IntegerField(min_value=0, max_value=255, required=False)
    alarm_severity = serializers.IntegerField(min_value=0, max_value=3, required=False)
    accel_magnitude = serializers.FloatField(required=False)

    def validate(self, attrs):
        candidates = ('co', 'co_ppm', 'temp', 'temp_c', 'hum', 'humidity_pct',
                      'press', 'pressure_pa', 'gas_res', 'gas_resistance_ohm',
                      'batt', 'battery_v', 'battery_pct')
        if not any(k in attrs for k in candidates):
            raise serializers.ValidationError('At least one measurement metric is required in telemetry payload')
        return attrs


class AlertPayloadSerializer(serializers.Serializer):
    severity = serializers.ChoiceField(choices=('INFO', 'WARNING', 'CRITICAL'))
    code = serializers.CharField(max_length=32, required=False)
    alert_code = serializers.CharField(max_length=32, required=False)
    details = serializers.CharField(max_length=2000, allow_blank=True, required=False)
    val = serializers.FloatField(min_value=0, required=False)
    trigger_value = serializers.FloatField(min_value=0, required=False)

    def validate(self, attrs):
        if not attrs.get('code') and not attrs.get('alert_code'):
            raise serializers.ValidationError('code or alert_code is required')
        return attrs


class HeartbeatPayloadSerializer(serializers.Serializer):
    heap = serializers.IntegerField(min_value=0, max_value=2_147_483_647, required=False)
    free_heap = serializers.IntegerField(min_value=0, max_value=2_147_483_647, required=False)
    batt = serializers.FloatField(min_value=0, max_value=10, required=False)
    battery_v = serializers.FloatField(min_value=0, max_value=10, required=False)

    def validate(self, attrs):
        if 'heap' not in attrs and 'free_heap' not in attrs:
            raise serializers.ValidationError('heap or free_heap is required')
        if 'batt' not in attrs and 'battery_v' not in attrs:
            raise serializers.ValidationError('batt or battery_v is required')
        return attrs


class ProvisionPayloadSerializer(serializers.Serializer):
    clock_request = serializers.JSONField(required=False)
    chip_id = serializers.CharField(max_length=16, allow_blank=False, required=False)
    chip_mac = serializers.CharField(max_length=24, allow_blank=False, required=False)
    mesh_id = serializers.IntegerField(min_value=0, required=False)
    fw_ver = serializers.CharField(max_length=16, required=False)
    batt = serializers.FloatField(min_value=0, max_value=10, required=False)
    mq_ok = serializers.BooleanField(required=False)
    mpu_ok = serializers.BooleanField(required=False)


class LocalAckPayloadSerializer(serializers.Serializer):
    cleared_alarms = serializers.IntegerField(min_value=0, max_value=255, required=False)
    cleared = serializers.IntegerField(min_value=0, max_value=255, required=False)
    held_ms = serializers.IntegerField(min_value=0, required=False)
    device_id = serializers.CharField(max_length=32, required=False, allow_blank=True)
    device = serializers.CharField(max_length=32, required=False, allow_blank=True)


def validate_payload(serializer_class, payload):
    serializer = serializer_class(data=payload)
    if not serializer.is_valid():
        return None, {"error": "Invalid message payload", "details": serializer.errors}
    return serializer.validated_data, None
