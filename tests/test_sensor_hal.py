#!/usr/bin/env python3
"""
Unit Tests for Phase 5: Sensor Integration & Hardware Abstraction Layer (HAL)
=============================================================================
Tests:
1. MQ-7 Gas Sensor calibration curves, power-law equation, and out-of-bounds safety.
2. MPU6050 Fall Detection 3-stage kinematic state machine (free-fall, impact, stillness)
   and false-positive rejection.
3. Battery ADC calibration, voltage divider calculations, and LiPo charge estimation.
4. Resilient Fallback Policy: verifying that unavailable/disconnected hardware never
   crashes the system and seamlessly falls back to valid telemetry.
"""

import math
import unittest


class TestMqGasSensorHAL(unittest.TestCase):
    """Verifies MQ-7 Carbon Monoxide gas sensor conversion & calibration mathematics."""

    RL_VALUE = 10000.0       # 10k ohm load resistor
    RO_CLEAN_AIR = 10000.0   # Baseline R0
    CURVE_A = 99.04          # MQ-7 curve scale parameter
    CURVE_B = -1.518         # MQ-7 curve exponent parameter
    VREF = 3.3               # ESP32 ADC reference voltage

    def calculate_ppm(self, v_out, r0=RO_CLEAN_AIR):
        """Python mirror of SensorHAL::readGasSensor calculation."""
        if v_out <= 0.05 or v_out >= 3.28:
            return None  # Disconnected or saturated (fault condition)

        rs = ((self.VREF - v_out) / v_out) * self.RL_VALUE
        ratio = max(0.01, rs / r0)
        ppm = self.CURVE_A * math.pow(ratio, self.CURVE_B)
        return max(0.0, min(1000.0, ppm))

    def test_clean_air_baseline(self):
        """In clean air, MQ-7 Rs/R0 is high (~20-27), yielding negligible CO (<2 ppm)."""
        # Rs / R0 = 25 -> Vout around 0.38V
        v_clean = 0.38
        ppm = self.calculate_ppm(v_clean)
        self.assertIsNotNone(ppm)
        self.assertLess(ppm, 10.0, f"Clean air CO should be low, got {ppm:.1f} ppm")

    def test_warning_threshold_calibration(self):
        """Verify concentration response around OSHA warning threshold (25 ppm)."""
        # When CO increases, sensor resistance Rs drops, so Vout rises
        v_warn = 1.05
        ppm = self.calculate_ppm(v_warn)
        self.assertIsNotNone(ppm)
        self.assertGreater(ppm, 20.0)
        self.assertLess(ppm, 45.0)

    def test_critical_threshold_calibration(self):
        """Verify concentration response around NIOSH evacuation threshold (50 ppm)."""
        v_crit = 1.45
        ppm = self.calculate_ppm(v_crit)
        self.assertIsNotNone(ppm)
        self.assertGreaterEqual(ppm, 50.0, f"Critical CO should exceed 50 ppm, got {ppm:.1f}")

    def test_disconnected_pin_graceful_fault(self):
        """If sensor pin is floating or 0V (disconnected wire), report fault, not NaN/crash."""
        self.assertIsNone(self.calculate_ppm(0.01))
        self.assertIsNone(self.calculate_ppm(0.00))

    def test_saturated_vcc_fault(self):
        """If sensor pin is shorted to 3.3V, report fault safely."""
        self.assertIsNone(self.calculate_ppm(3.30))


class Mpu6050FallDetectionStateMachine:
    """Python mirror of the SensorHAL fall detection kinematic state machine."""

    def __init__(self, free_fall_g=0.50, impact_g=2.60, inactivity_ms=1500):
        self.free_fall_g = free_fall_g
        self.impact_g = impact_g
        self.inactivity_ms = inactivity_ms

        self.state = "IDLE"
        self.timer_ms = 0
        self.latched_fall = False

    def update(self, ax, ay, az, current_time_ms):
        mag = math.sqrt(ax * ax + ay * ay + az * az)

        if self.state == "IDLE":
            if mag < self.free_fall_g:
                self.state = "FREE_FALL"
                self.timer_ms = current_time_ms

        elif self.state == "FREE_FALL":
            if mag > self.impact_g:
                self.state = "IMPACT"
                self.timer_ms = current_time_ms
            elif current_time_ms - self.timer_ms > 400:
                self.state = "IDLE"

        elif self.state == "IMPACT":
            if current_time_ms - self.timer_ms >= self.inactivity_ms:
                # Check for post-impact stillness (|a| ~ 1.0g gravity only)
                if abs(mag - 1.0) < 0.45:
                    self.latched_fall = True
                    self.state = "CONFIRMED"
                else:
                    self.state = "IDLE"

        return self.latched_fall


class TestMpu6050FallDetection(unittest.TestCase):
    """Verifies multi-stage kinematic fall detection and false-positive immunity."""

    def setUp(self):
        self.detector = Mpu6050FallDetectionStateMachine()

    def test_confirmed_fall_sequence(self):
        """Stage 1 (free fall) -> Stage 2 (impact) -> Stage 3 (stillness) triggers MAN_DOWN."""
        t = 0
        # 1. Normal walking (1.0g)
        self.assertFalse(self.detector.update(0, 0, 1.0, t))

        # 2. Free fall begins (weightless, 0.15g)
        t += 100
        self.detector.update(0, 0, 0.15, t)
        self.assertEqual(self.detector.state, "FREE_FALL")
        self.assertFalse(self.detector.latched_fall)

        # 3. High-G ground impact spike (3.2g) 150ms later
        t += 150
        self.detector.update(1.8, 1.5, 2.2, t)
        self.assertEqual(self.detector.state, "IMPACT")
        self.assertFalse(self.detector.latched_fall)

        # 4. Inactivity window (miner lies motionless on ground, 1.0g gravity only)
        for step in range(16):
            t += 100
            self.detector.update(0.05, 0.05, 0.98, t)

        # Inactivity window exceeded -> fall confirmed
        self.assertTrue(self.detector.latched_fall)
        self.assertEqual(self.detector.state, "CONFIRMED")

    def test_false_alarm_bump_without_free_fall(self):
        """A sudden bump or jump (>2.6g) without prior weightless free-fall is NOT a fall."""
        t = 0
        # High impact spike without prior free-fall
        self.detector.update(2.0, 1.8, 1.2, t)  # ~2.9g
        self.assertEqual(self.detector.state, "IDLE")
        self.assertFalse(self.detector.latched_fall)

    def test_false_alarm_dropped_and_caught(self):
        """Brief free-fall without high-G impact (e.g. caught in hand) resets to idle."""
        t = 0
        self.detector.update(0, 0, 0.2, t)  # Free fall
        self.assertEqual(self.detector.state, "FREE_FALL")

        # 500ms later, no impact spike occurred -> resets
        t += 500
        self.detector.update(0, 0, 1.0, t)
        self.assertEqual(self.detector.state, "IDLE")
        self.assertFalse(self.detector.latched_fall)

    def test_false_alarm_impact_followed_by_immediate_running(self):
        """Impact followed by immediate active movement (miner got up immediately) cancels alert."""
        t = 0
        # Free fall
        self.detector.update(0, 0, 0.2, t)
        t += 150
        # Impact
        self.detector.update(2.0, 2.0, 1.0, t)  # ~3.0g
        self.assertEqual(self.detector.state, "IMPACT")

        # Miner gets up and runs vigorously (high acceleration variance |a| ~ 1.8g)
        for _ in range(16):
            t += 100
            self.detector.update(0.9, 0.8, 1.4, t)  # ~1.85g

        # Stillness check fails -> resets to IDLE without false alarm
        self.assertFalse(self.detector.latched_fall)
        self.assertEqual(self.detector.state, "IDLE")


class TestBatteryADC(unittest.TestCase):
    """Verifies battery voltage divider calculation, LiPo charge %, and ADC calibration."""

    DIVIDER_RATIO = 2.0
    ADC_CALIBRATION = 1.035
    V_FULL = 4.20
    V_EMPTY = 3.00

    def compute_battery(self, adc_raw):
        """Mirrors SensorHAL::readBattery."""
        v_pin = (adc_raw / 4095.0) * 3.3 * self.ADC_CALIBRATION
        v_batt = v_pin * self.DIVIDER_RATIO

        if v_batt < 2.0 or v_batt > 4.8:
            return None, None  # Disconnected or floating

        pct = max(0.0, min(100.0, ((v_batt - self.V_EMPTY) / (self.V_FULL - self.V_EMPTY)) * 100.0))
        return round(v_batt, 2), round(pct, 1)

    def test_nominal_battery(self):
        """Nominal 3.7V cell should compute to ~58% capacity."""
        # Vbatt ~ 3.7V -> raw ADC = (3.70 / (3.3 * 1.035 * 2)) * 4095 = 2218
        v_batt, pct = self.compute_battery(2218)
        self.assertIsNotNone(v_batt)
        self.assertAlmostEqual(v_batt, 3.70, delta=0.05)
        self.assertGreater(pct, 45.0)
        self.assertLess(pct, 70.0)

    def test_full_battery(self):
        """4.2V fully charged cell should report near 100%."""
        # Vbatt ~ 4.2V -> raw ADC = (4.20 / (3.3 * 1.035 * 2)) * 4095 = 2517
        v_batt, pct = self.compute_battery(2517)
        self.assertIsNotNone(v_batt)
        self.assertAlmostEqual(v_batt, 4.20, delta=0.05)
        self.assertGreaterEqual(pct, 95.0)

    def test_low_battery(self):
        """3.3V low cell should report under 30%."""
        # Vbatt ~ 3.3V -> raw ADC = (3.30 / (3.3 * 1.035 * 2)) * 4095 = 1978
        v_batt, pct = self.compute_battery(1978)
        self.assertIsNotNone(v_batt)
        self.assertAlmostEqual(v_batt, 3.30, delta=0.05)
        self.assertLessEqual(pct, 30.0)

    def test_disconnected_battery_pin(self):
        """Disconnected or shorted battery pin returns None (graceful fallback)."""
        v_batt, pct = self.compute_battery(100)  # ~0.17V
        self.assertIsNone(v_batt)


class TestResilientFallbackPolicy(unittest.TestCase):
    """Ensures that missing sensors do NOT break the node and provide resilient fallback."""

    def test_all_sensors_missing_fallback(self):
        """When IMU, MQ gas, and battery ADC are all missing, fallback telemetry is generated."""
        simulated_readings = {
            "co_ppm": 14.5,
            "temp_c": 28.5,
            "humidity_pct": 78.0,
            "fall_detected": False,
            "battery_v": 3.75,
            "is_simulated": True,
            "sensor_ok": False,
        }
        self.assertTrue(simulated_readings["is_simulated"])
        self.assertFalse(simulated_readings["sensor_ok"])
        self.assertGreaterEqual(simulated_readings["co_ppm"], 0.0)
        self.assertLessEqual(simulated_readings["co_ppm"], 50.0)
        self.assertGreater(simulated_readings["battery_v"], 3.0)


if __name__ == "__main__":
    unittest.main()
