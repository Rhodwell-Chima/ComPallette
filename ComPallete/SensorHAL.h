#ifndef SENSOR_HAL_H
#define SENSOR_HAL_H

#include <Arduino.h>
#include <Wire.h>
#include "Config.h"
#include "Protocol.h"
#include "SafetyLogic.h"

// ============================================================================
// COMPALLETTE - HARDWARE ABSTRACTION LAYER (HAL)
// ============================================================================
// Provides a unified, resilient interface to physical environmental & biometric
// sensors on ESP32 wearable nodes:
// 1. Adafruit BME688 (Temperature, Relative Humidity, Pressure, Gas Resistance)
// 2. MPU6050 6-Axis IMU (Kinematic free-fall & impact "Man Down" detection via I2C)
// 3. Battery Fuel Gauge (MAX17048 / LC709203F or calibrated ADC divider)
// 4. Panic & Acknowledge Buttons + Alarm Actuators (Strobe LED & Buzzer)
//
// SAFETY GUARANTEE:
// - Button input ownership belongs exclusively to the emergency input handler.
//   Telemetry and diagnostic polling never consume button presses.
// - Alarm arbitration preserves the highest active severity.
// - A 2-second hold on the separate acknowledge button clears only alarms
//   active when the hold started; new alarms arriving during hold survive.
// - BME688 gas resistance is raw and never populates co_ppm.

struct SensorReadings {
  float co_ppm;              // Carbon Monoxide concentration (ppm, legacy hardware only)
  float temp_c;              // Ambient temperature (Celsius, from BME688)
  float humidity_pct;        // Relative humidity (% RH, from BME688)
  float pressure_pa;         // Barometric pressure (Pascals, from BME688)
  float gas_resistance_ohm;  // Raw gas resistance (Ohms, from BME688)
  bool  bme_healthy;         // True if BME688 sensor is responsive on I2C
  bool  bme_warming;         // True if gas heater is in initial warming / conditioning
  bool  bme_gas_valid;       // True if gas resistance measurement is valid
  bool  bme_heater_stable;   // True if heater temperature reached target stability
  bool  fall_detected;       // True if fall event detected and not yet cleared
  float battery_v;           // Calibrated LiPo battery voltage (Volts)
  float battery_pct;         // Estimated battery charge level (0 - 100%)
  uint8_t battery_gauge_type;// 0: divider ADC, 1: MAX17048, 2: LC709203F, 255: missing/failed
  bool  battery_healthy;     // True if fuel gauge or ADC returns plausible voltage
  float accel_x;             // Acceleration X (g)
  float accel_y;             // Acceleration Y (g)
  float accel_z;             // Acceleration Z (g)
  float accel_magnitude;     // Total acceleration vector |a| (g)
  float imu_temp_c;          // Internal IMU die temperature (distinct from environmental)
  bool  mq_healthy;          // True if legacy MQ gas sensor is responsive
  bool  mpu_healthy;         // True if MPU6050 IMU is responsive
  bool  sensor_ok;           // Overall sensor system health
  bool  is_simulated;        // True if data was generated synthetically via test profile
  bool  panic_pressed;       // True if physical SOS emergency button was triggered
  bool  ack_pressed;         // True if physical acknowledge button is pressed
  uint8_t active_alarms;     // Mask of currently active alarms (Safety::Alarm)
  unsigned alarm_severity;   // Current arbitrated severity level (0 to 3)
  char  status_message[64];  // Diagnostic status or fault description
};

class SensorHAL {
public:
  SensorHAL();

  // Initialize all hardware pins, I2C bus, ADC calibration, and probe attached sensors
  bool begin();

  // Sample environmental sensors and compute calibrated readings with fault protection
  // Note: read() never consumes emergency button events.
  SensorReadings read();

  // Update emergency inputs (SOS button, Acknowledge button) with bounded debounce.
  // Must be called from the high-rate loop (~100 Hz).
  // Returns true if a new emergency SOS event was triggered.
  bool updateEmergencyInputs(uint32_t now);

  // Check if acknowledge button held for >= 2000 ms. Returns mask of cleared alarms.
  uint8_t checkAlarmAcknowledge(uint32_t now);

  // Query hardware subsystem availability
  bool isBmeAvailable() const { return _bmeAvailable; }
  bool isBmeWarming() const { return _bmeWarming; }
  bool isMpuAvailable() const { return _mpuAvailable; }
  bool isMqAvailable() const { return _mqAvailable; }
  bool isBatteryAvailable() const { return _batteryAvailable; }
  uint8_t getBatteryGaugeType() const { return _batteryGaugeType; }

  // Check if SOS was triggered on this cycle
  bool checkPanicButton();

  // Raise an alarm on the central alarm controller
  void raiseAlarm(Safety::Alarm alarm);

  // Query active alarms and arbitrated severity
  uint8_t getActiveAlarms() const { return _alarms.active(); }
  unsigned getAlarmSeverity() const { return _alarms.severity(); }

  // Control physical alert indicators (strobe LED & buzzer)
  void setAlarmIndication(bool active, AlertSeverity severity = SEVERITY_WARNING);

  // Refresh alarm indication according to current highest arbitrated severity
  void refreshAlarmIndication();

  // Acknowledge and reset latched fall detection flag
  void resetFallFlag();

  // Calibrate clean-air baseline resistance (R0) for legacy MQ gas sensor
  void calibrateMqZero(float customRo = 0.0f);

  // Print detailed hardware diagnostic report to Serial
  void printDiagnostics();

private:
  // Hardware availability & health flags
  bool _initialized;
  bool _bmeAvailable;
  bool _bmeWarming;
  bool _mpuAvailable;
  bool _mqAvailable;
  bool _batteryAvailable;
  uint8_t _bmeI2cAddress;
  uint8_t _mpuI2cAddress;
  uint8_t _batteryGaugeType; // 0=divider, 1=MAX17048, 2=LC709203F, 255=none
  uint8_t _gaugeI2cAddress;

  // Calibrated baseline values
  float _mqRo;
  uint32_t _bootTimeMs;
  uint32_t _bmeWarmupStartMs;

  // Safety logic components
  Safety::DebouncedButton _sosButton;
  Safety::DebouncedButton _ackButton;
  Safety::Alarms          _alarms;
  Safety::FallDetector    _fallDetector;
  bool                    _sosPressedEvent;

  // Internal hardware helper methods
  bool probeI2CDevice(uint8_t addr);
  bool initBME688();
  bool initMPU6050();
  bool initBatteryGauge();
  bool readBME688(float &temp, float &hum, float &press, float &gasRes, bool &warming, bool &gasValid);
  bool readMPU6050(float &ax, float &ay, float &az, float &temp);
  bool readBatteryGauge(float &volts, float &pct);
  float readGasSensor(bool &healthy);
  float readBatteryDivider(bool &healthy);
  SensorReadings generateFallbackReadings();
};

extern SensorHAL sensorHAL;

#endif // SENSOR_HAL_H
