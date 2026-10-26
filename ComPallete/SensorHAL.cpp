#include "SensorHAL.h"
#include <math.h>

// Global HAL singleton instance
SensorHAL sensorHAL;

// MPU6050 Registers
#define MPU_REG_PWR_MGMT_1    0x6B
#define MPU_REG_ACCEL_CONFIG  0x1C
#define MPU_REG_ACCEL_XOUT_H  0x3B
#define MPU_REG_TEMP_OUT_H    0x41
#define MPU_REG_WHO_AM_I      0x75

SensorHAL::SensorHAL()
  : _initialized(false),
    _mpuAvailable(false),
    _mqAvailable(false),
    _batteryAvailable(false),
    _mpuI2cAddress(MPU6050_I2C_ADDR),
    _mqRo(MQ7_RO_CLEAN_AIR),
    _bootTimeMs(0),
    _fallState(FALL_IDLE),
    _fallTimerMs(0),
    _latchedFall(false),
    _lastButtonState(HIGH),
    _lastButtonDebounceMs(0) {
}

bool SensorHAL::begin() {
  _bootTimeMs = millis();

  // 1. Configure Actuators & Discrete Inputs
  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);

  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  pinMode(PIN_SOS_BUTTON, INPUT_PULLUP);

  // 2. Configure ESP32 ADC for Analog Inputs
  // Using 12-bit resolution (0-4095) with 11dB attenuation (~0 - 3.3V range)
  pinMode(PIN_GAS_ANALOG, INPUT);
  pinMode(PIN_BATTERY_ADC, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_GAS_ANALOG, ADC_11db);
  analogSetPinAttenuation(PIN_BATTERY_ADC, ADC_11db);

  Serial.println("[HAL] Initializing Hardware Abstraction Layer...");

  // 3. Initialize I2C Bus with Safe Timeout
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setTimeOut(50); // 50ms safety timeout prevents bus lockup if lines are open

  // Probe MPU6050 at primary (0x68) and secondary (0x69) addresses
  if (probeI2CDevice(MPU6050_I2C_ADDR)) {
    _mpuI2cAddress = MPU6050_I2C_ADDR;
    _mpuAvailable = initMPU6050();
  } else if (probeI2CDevice(MPU6050_I2C_ADDR_ALT)) {
    _mpuI2cAddress = MPU6050_I2C_ADDR_ALT;
    _mpuAvailable = initMPU6050();
  } else {
    _mpuAvailable = false;
    Serial.println("[HAL] NOTICE: MPU6050 IMU not found on I2C bus. Fall detection will use resilient fallback.");
  }

  // 4. Probe MQ Gas Sensor
  int mqRaw = analogRead(PIN_GAS_ANALOG);
  if (mqRaw > 30 && mqRaw < 4080) {
    _mqAvailable = true;
    Serial.printf("[HAL] MQ-7 gas sensor detected on GPIO %d (Raw ADC: %d)\n", PIN_GAS_ANALOG, mqRaw);
  } else {
    _mqAvailable = false;
    Serial.printf("[HAL] NOTICE: MQ Gas sensor reading out of nominal range on GPIO %d (Raw ADC: %d). Will use fallback.\n", PIN_GAS_ANALOG, mqRaw);
  }

  // 5. Probe Battery ADC
  int battRaw = analogRead(PIN_BATTERY_ADC);
  float testVolt = (battRaw / 4095.0f) * 3.3f * BATTERY_DIVIDER_RATIO * BATTERY_ADC_CALIBRATION;
  if (testVolt >= 2.0f && testVolt <= 5.0f) {
    _batteryAvailable = true;
    Serial.printf("[HAL] Battery monitor active on GPIO %d (Calibrated: %.2f V)\n", PIN_BATTERY_ADC, testVolt);
  } else {
    _batteryAvailable = false;
    Serial.printf("[HAL] NOTICE: Battery divider reading on GPIO %d is floating/inactive (%.2f V). Defaulting to nominal 3.7V.\n", PIN_BATTERY_ADC, testVolt);
  }

  _initialized = true;

  // Print startup summary
  printDiagnostics();

  // Indicate successful HAL boot via short double LED flash
  digitalWrite(PIN_STATUS_LED, HIGH);
  delay(50);
  digitalWrite(PIN_STATUS_LED, LOW);
  delay(50);
  digitalWrite(PIN_STATUS_LED, HIGH);
  delay(50);
  digitalWrite(PIN_STATUS_LED, LOW);

  return true;
}

bool SensorHAL::probeI2CDevice(uint8_t addr) {
  Wire.beginTransmission(addr);
  return (Wire.endTransmission() == 0);
}

bool SensorHAL::initMPU6050() {
  // Read WHO_AM_I register (0x75)
  Wire.beginTransmission(_mpuI2cAddress);
  Wire.write(MPU_REG_WHO_AM_I);
  if (Wire.endTransmission(false) != 0) return false;

  Wire.requestFrom(_mpuI2cAddress, (uint8_t)1);
  if (!Wire.available()) return false;
  uint8_t whoAmI = Wire.read();

  if (whoAmI != 0x68 && whoAmI != 0x69 && whoAmI != 0x70) {
    Serial.printf("[HAL] MPU6050 WHO_AM_I mismatch: 0x%02X (Expected 0x68)\n", whoAmI);
    return false;
  }

  // Wake up MPU6050 (write 0x00 to PWR_MGMT_1)
  Wire.beginTransmission(_mpuI2cAddress);
  Wire.write(MPU_REG_PWR_MGMT_1);
  Wire.write(0x00);
  if (Wire.endTransmission() != 0) return false;

  // Configure Accelerometer to +/- 4g range (write 0x08 to ACCEL_CONFIG)
  // Scale factor: 8192 LSB/g
  Wire.beginTransmission(_mpuI2cAddress);
  Wire.write(MPU_REG_ACCEL_CONFIG);
  Wire.write(0x08);
  if (Wire.endTransmission() != 0) return false;

  Serial.printf("[HAL] MPU6050 IMU initialized successfully at I2C 0x%02X (+/-4g range)\n", _mpuI2cAddress);
  return true;
}

bool SensorHAL::readMPU6050(float &ax, float &ay, float &az, float &temp) {
  if (!_mpuAvailable) return false;

  Wire.beginTransmission(_mpuI2cAddress);
  Wire.write(MPU_REG_ACCEL_XOUT_H);
  if (Wire.endTransmission(false) != 0) return false;

  // Request 6 bytes of accel + 2 bytes of temperature = 8 bytes
  uint8_t bytesReceived = Wire.requestFrom(_mpuI2cAddress, (uint8_t)8);
  if (bytesReceived < 8) return false;

  int16_t rawAx = (Wire.read() << 8) | Wire.read();
  int16_t rawAy = (Wire.read() << 8) | Wire.read();
  int16_t rawAz = (Wire.read() << 8) | Wire.read();
  int16_t rawTemp = (Wire.read() << 8) | Wire.read();

  // Convert raw readings with +/-4g scale (8192 LSB/g)
  ax = (float)rawAx / 8192.0f;
  ay = (float)rawAy / 8192.0f;
  az = (float)rawAz / 8192.0f;

  // MPU6050 on-chip temperature sensor formula: (raw / 340.0) + 36.53
  temp = ((float)rawTemp / 340.0f) + 36.53f;

  return true;
}

void SensorHAL::processFallDetection(float ax, float ay, float az) {
  float mag = sqrtf(ax * ax + ay * ay + az * az);
  uint32_t now = millis();

  switch (_fallState) {
    case FALL_IDLE:
      // Stage 1: Detect free-fall (weightlessness condition: |a| < 0.5g)
      if (mag < FALL_FREE_FALL_G) {
        _fallState = FALL_FREE_FALL_DETECTED;
        _fallTimerMs = now;
      }
      break;

    case FALL_FREE_FALL_DETECTED:
      // Stage 2: Detect subsequent high-impact spike (|a| > 2.6g) within 400ms
      if (mag > FALL_IMPACT_G) {
        _fallState = FALL_IMPACT_DETECTED;
        _fallTimerMs = now;
      } else if (now - _fallTimerMs > 400) {
        // Timed out without an impact; return to idle
        _fallState = FALL_IDLE;
      }
      break;

    case FALL_IMPACT_DETECTED:
      // Stage 3: Post-impact stillness confirmation
      // If miner remains stationary for the stillness window, trigger fall alert
      if (now - _fallTimerMs >= FALL_INACTIVITY_MS) {
        // Verify miner is not vigorously moving
        if (fabsf(mag - 1.0f) < 0.45f) {
          _latchedFall = true;
          _fallState = FALL_CONFIRMED;
          Serial.println("\n[HAL ALERT] MAN DOWN CONFIRMED: Free-fall + Impact + Prolonged Inactivity verified!");
        } else {
          // Miner got back up and is moving; cancel false alarm
          _fallState = FALL_IDLE;
        }
      }
      break;

    case FALL_CONFIRMED:
      // Remains latched until explicitly acknowledged or cleared
      break;
  }
}

float SensorHAL::readGasSensor(bool &healthy) {
  if (!_mqAvailable) {
    healthy = false;
    return 14.5f; // Safe baseline fallback
  }

  // Oversample ADC 8 times to filter noise
  uint32_t adcSum = 0;
  for (int i = 0; i < 8; i++) {
    adcSum += analogRead(PIN_GAS_ANALOG);
    delayMicroseconds(250);
  }
  float adcAvg = (float)adcSum / 8.0f;

  // Sensor disconnected or shorted check
  if (adcAvg < 20.0f || adcAvg > 4080.0f) {
    healthy = false;
    return 15.0f;
  }

  // Calculate sensor output voltage (0 to 3.3V)
  float vOut = (adcAvg / 4095.0f) * MQ7_VREF;
  if (vOut <= 0.05f) {
    healthy = false;
    return 12.0f;
  }

  // Calculate sensor resistance: Rs = ((Vcc - Vout) / Vout) * RL
  float rs = ((MQ7_VREF - vOut) / vOut) * MQ7_RL_VALUE;
  float ratio = rs / _mqRo;

  if (ratio <= 0.01f) ratio = 0.01f;

  // Apply power-law calibration equation: PPM = A * (Rs / R0)^B
  float ppm = MQ7_CURVE_A * powf(ratio, MQ7_CURVE_B);

  // Clamp ppm within reasonable mining physical boundaries (0 to 1000 ppm)
  if (ppm < 0.0f) ppm = 0.0f;
  if (ppm > 1000.0f) ppm = 1000.0f;

  healthy = true;
  return ppm;
}

float SensorHAL::readBattery(bool &healthy) {
  if (!_batteryAvailable) {
    healthy = false;
    return BATTERY_VOLTAGE_NOMINAL;
  }

  // Oversample ADC 8 times
  uint32_t adcSum = 0;
  for (int i = 0; i < 8; i++) {
    adcSum += analogRead(PIN_BATTERY_ADC);
    delayMicroseconds(250);
  }
  float adcAvg = (float)adcSum / 8.0f;

  // Calculate voltage at divider output
  float vPin = (adcAvg / 4095.0f) * 3.3f * BATTERY_ADC_CALIBRATION;
  // Reconstruct full battery pack voltage
  float vBatt = vPin * BATTERY_DIVIDER_RATIO;

  if (vBatt < 2.5f || vBatt > 4.5f) {
    healthy = false;
    return BATTERY_VOLTAGE_NOMINAL;
  }

  healthy = true;
  return vBatt;
}

bool SensorHAL::checkPanicButton() {
  int reading = digitalRead(PIN_SOS_BUTTON);

  // Active LOW button with software debounce
  if (reading != _lastButtonState) {
    _lastButtonDebounceMs = millis();
  }

  bool pressed = false;
  if ((millis() - _lastButtonDebounceMs) > 40) {
    if (reading == LOW && _lastButtonState == HIGH) {
      pressed = true;
      Serial.println("\n[HAL ALERT] Physical Emergency SOS Panic Button Triggered!");
    }
  }

  _lastButtonState = reading;
  return pressed;
}

void SensorHAL::setAlarmIndication(bool active, AlertSeverity severity) {
  if (!active) {
    digitalWrite(PIN_STATUS_LED, LOW);
    digitalWrite(PIN_BUZZER, LOW);
    return;
  }

  if (severity == SEVERITY_CRITICAL) {
    // Fast emergency pulse
    digitalWrite(PIN_STATUS_LED, HIGH);
    digitalWrite(PIN_BUZZER, HIGH);
  } else {
    // Intermittent warning pulse
    digitalWrite(PIN_STATUS_LED, HIGH);
    digitalWrite(PIN_BUZZER, LOW);
  }
}

void SensorHAL::resetFallFlag() {
  _latchedFall = false;
  _fallState = FALL_IDLE;
  Serial.println("[HAL] Latched fall event cleared.");
}

void SensorHAL::calibrateMqZero(float customRo) {
  if (customRo > 100.0f) {
    _mqRo = customRo;
    Serial.printf("[HAL] Custom MQ gas R0 set to %.1f ohms\n", _mqRo);
    return;
  }

  // Auto-calibrate R0 from clean air reading
  int mqRaw = analogRead(PIN_GAS_ANALOG);
  float vOut = (mqRaw / 4095.0f) * MQ7_VREF;
  if (vOut > 0.05f && vOut < 3.25f) {
    float rsAir = ((MQ7_VREF - vOut) / vOut) * MQ7_RL_VALUE;
    // For MQ-7 in clean air, Rs / R0 ~ 27.0
    _mqRo = rsAir / 27.0f;
    Serial.printf("[HAL] Calibrated clean-air R0: %.1f ohms (Rs: %.1f ohms)\n", _mqRo, rsAir);
  }
}

SensorReadings SensorHAL::generateFallbackReadings() {
  SensorReadings r;
  // Clean synthetic telemetry matching underground Zambian baseline conditions
  r.co_ppm = (float)random(90, 220) / 10.0f; // 9.0 - 22.0 ppm
  r.temp_c = 28.5f + (float)random(-15, 25) / 10.0f;
  r.humidity_pct = 78.0f + (float)random(0, 120) / 10.0f;
  r.fall_detected = false;
  r.battery_v = 3.82f - ((float)(millis() % 3600000) / 3600000.0f) * 0.15f;
  r.battery_pct = constrain(((r.battery_v - 3.0f) / 1.2f) * 100.0f, 0.0f, 100.0f);
  r.accel_x = 0.02f;
  r.accel_y = 0.01f;
  r.accel_z = 0.99f;
  r.accel_magnitude = 1.00f;
  r.mq_healthy = _mqAvailable;
  r.mpu_healthy = _mpuAvailable;
  r.battery_healthy = _batteryAvailable;
  r.sensor_ok = false; // Flagged as synthetic
  r.is_simulated = true;
  r.panic_pressed = checkPanicButton();
  strncpy(r.status_message, "Operating in Resilient Simulation Fallback Mode", sizeof(r.status_message) - 1);
  return r;
}

SensorReadings SensorHAL::read() {
  // If simulation is forced via configuration, return synthetic readings
  if (SIMULATE_SENSORS) {
    return generateFallbackReadings();
  }

  // If no hardware sensors are active and auto-detect is on, gracefully fallback
  if (!_mpuAvailable && !_mqAvailable && !_batteryAvailable && SENSOR_AUTO_DETECT) {
    return generateFallbackReadings();
  }

  SensorReadings r;
  r.is_simulated = false;
  r.panic_pressed = checkPanicButton();

  // 1. Read Gas Sensor
  bool mqOk = false;
  r.co_ppm = readGasSensor(mqOk);
  r.mq_healthy = mqOk;

  // 2. Read IMU
  float ax = 0, ay = 0, az = 1.0f, mpuTemp = 28.0f;
  bool mpuOk = readMPU6050(ax, ay, az, mpuTemp);
  r.mpu_healthy = mpuOk;
  r.accel_x = ax;
  r.accel_y = ay;
  r.accel_z = az;
  r.accel_magnitude = sqrtf(ax * ax + ay * ay + az * az);
  r.temp_c = mpuOk ? mpuTemp : 28.0f;
  r.humidity_pct = 80.0f; // Ambient baseline mine humidity

  // Update fall detection state machine
  if (mpuOk) {
    processFallDetection(ax, ay, az);
    r.fall_detected = _latchedFall;
  } else {
    r.fall_detected = false;
  }

  // 3. Read Battery
  bool battOk = false;
  r.battery_v = readBattery(battOk);
  r.battery_healthy = battOk;
  r.battery_pct = constrain(((r.battery_v - BATTERY_VOLTAGE_EMPTY) /
                            (BATTERY_VOLTAGE_FULL - BATTERY_VOLTAGE_EMPTY)) * 100.0f, 0.0f, 100.0f);

  // Overall system health status
  r.sensor_ok = (r.mq_healthy || !_mqAvailable) &&
                (r.mpu_healthy || !_mpuAvailable) &&
                (r.battery_healthy || !_batteryAvailable);

  if (!r.mq_healthy && !r.mpu_healthy) {
    r.is_simulated = true;
    strncpy(r.status_message, "Hardware sensors unreachable; fallback telemetry active", sizeof(r.status_message) - 1);
  } else if (!r.mq_healthy) {
    strncpy(r.status_message, "Gas sensor degraded; IMU active", sizeof(r.status_message) - 1);
  } else if (!r.mpu_healthy) {
    strncpy(r.status_message, "IMU offline; Gas sensor active", sizeof(r.status_message) - 1);
  } else {
    strncpy(r.status_message, "All hardware sensors nominal", sizeof(r.status_message) - 1);
  }

  return r;
}

void SensorHAL::printDiagnostics() {
  Serial.println("\n--------------------------------------------------------------");
  Serial.println("           COMPALLETTE HARDWARE ABSTRACTION LAYER DIAGNOSTICS ");
  Serial.println("--------------------------------------------------------------");
  Serial.printf("  Hardware Mode        : %s\n", SIMULATE_SENSORS ? "FORCED SYNTHETIC" : "PHYSICAL SAMPLING");
  Serial.printf("  MPU6050 6-Axis IMU   : %s (I2C Addr: 0x%02X, SDA=%d, SCL=%d)\n",
                _mpuAvailable ? "ONLINE (Healthy)" : "OFFLINE (Fallback Active)",
                _mpuI2cAddress, PIN_I2C_SDA, PIN_I2C_SCL);
  Serial.printf("  MQ-7 Gas Sensor (CO) : %s (ADC1 Pin: GPIO %d, R0: %.1f)\n",
                _mqAvailable ? "ONLINE (Healthy)" : "OFFLINE (Fallback Active)",
                PIN_GAS_ANALOG, _mqRo);
  Serial.printf("  Battery Monitor      : %s (ADC1 Pin: GPIO %d, Ratio: %.1f)\n",
                _batteryAvailable ? "ONLINE (Healthy)" : "OFFLINE (Nominal Default)",
                PIN_BATTERY_ADC, BATTERY_DIVIDER_RATIO);
  Serial.printf("  SOS Panic Button     : READY (GPIO %d, Active LOW)\n", PIN_SOS_BUTTON);
  Serial.printf("  Emergency Strobe/Buzz: READY (LED=%d, Buzzer=%d)\n", PIN_STATUS_LED, PIN_BUZZER);
  Serial.println("--------------------------------------------------------------\n");
}
