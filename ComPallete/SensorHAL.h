#ifndef SENSOR_HAL_H
#define SENSOR_HAL_H

#include <Arduino.h>
#include <Wire.h>
#include "Config.h"
#include "Protocol.h"

// ============================================================================
// COMPALLETTE - HARDWARE ABSTRACTION LAYER (HAL)
// ============================================================================
// Provides a unified, resilient interface to physical environmental & biometric
// sensors on ESP32 wearable nodes:
// 1. MQ-7 / MQ Gas Sensor (CO ppm via ADC1 with temperature/humidity compensation)
// 2. MPU6050 6-Axis IMU (Kinematic free-fall & impact "Man Down" detection via I2C)
// 3. Battery ADC Monitoring (1S LiPo/18650 voltage divider & level tracking)
// 4. Panic Button & Alarm Actuators (Emergency SOS button, buzzer & alert strobe)
//
// RESILIENCE GUARANTEE:
// If any physical sensor is disconnected, missing, or fails during runtime,
// the HAL gracefully switches that subsystem to safe fallback/synthetic telemetry
// without blocking the main loop or disrupting the mesh network.

struct SensorReadings {
  float co_ppm;              // Carbon Monoxide concentration (ppm)
  float temp_c;              // Ambient temperature (Celsius)
  float humidity_pct;        // Relative humidity (% RH)
  bool  fall_detected;       // True if fall event detected and not yet cleared
  float battery_v;           // Calibrated 1S LiPo battery voltage (Volts)
  float battery_pct;         // Estimated battery charge level (0 - 100%)
  float accel_x;             // Acceleration X (g)
  float accel_y;             // Acceleration Y (g)
  float accel_z;             // Acceleration Z (g)
  float accel_magnitude;     // Total acceleration vector |a| (g)
  bool  mq_healthy;          // True if MQ gas sensor is responsive
  bool  mpu_healthy;         // True if MPU6050 IMU is responsive
  bool  battery_healthy;     // True if battery ADC pin returns plausible voltage
  bool  sensor_ok;           // Overall sensor system health (true if all healthy)
  bool  is_simulated;        // True if data was generated synthetically via fallback
  bool  panic_pressed;       // True if physical SOS emergency button was triggered
  char  status_message[64];  // Diagnostic status or fault description
};

class SensorHAL {
public:
  SensorHAL();

  // Initialize all hardware pins, I2C bus, ADC calibration, and probe attached sensors
  bool begin();

  // Sample all sensors and compute calibrated readings with fault protection
  SensorReadings read();

  // Query hardware subsystem availability
  bool isMpuAvailable() const { return _mpuAvailable; }
  bool isMqAvailable() const { return _mqAvailable; }
  bool isBatteryAvailable() const { return _batteryAvailable; }

  // Check and debounce physical panic button (active LOW)
  bool checkPanicButton();

  // Control physical alert indicators (strobe LED & buzzer)
  void setAlarmIndication(bool active, AlertSeverity severity = SEVERITY_WARNING);

  // Acknowledge and reset latched fall detection flag
  void resetFallFlag();

  // Calibrate clean-air baseline resistance (R0) for the MQ gas sensor
  void calibrateMqZero(float customRo = 0.0f);

  // Print detailed hardware diagnostic report to Serial
  void printDiagnostics();

private:
  // Hardware availability & health flags
  bool _initialized;
  bool _mpuAvailable;
  bool _mqAvailable;
  bool _batteryAvailable;
  uint8_t _mpuI2cAddress;

  // Calibrated baseline values
  float _mqRo;
  uint32_t _bootTimeMs;

  // Fall detection state machine
  enum FallState {
    FALL_IDLE,
    FALL_FREE_FALL_DETECTED,
    FALL_IMPACT_DETECTED,
    FALL_CONFIRMED
  };
  FallState _fallState;
  uint32_t _fallTimerMs;
  bool _latchedFall;

  // Panic button debouncing state
  bool _lastButtonState;
  uint32_t _lastButtonDebounceMs;

  // Internal hardware helper methods
  bool probeI2CDevice(uint8_t addr);
  bool initMPU6050();
  bool readMPU6050(float &ax, float &ay, float &az, float &temp);
  void processFallDetection(float ax, float ay, float az);
  float readGasSensor(bool &healthy);
  float readBattery(bool &healthy);
  SensorReadings generateFallbackReadings();
};

extern SensorHAL sensorHAL;

#endif // SENSOR_HAL_H
