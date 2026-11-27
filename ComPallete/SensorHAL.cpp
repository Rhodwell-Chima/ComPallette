#include "SensorHAL.h"
#include "Logging.h"
#include <math.h>

static const char* const SENSOR_TAG = "CP_SENSOR";
static const char* const IMU_TAG = "CP_IMU";
static const char* const POWER_TAG = "CP_POWER";
static const char* const ALERT_TAG = "CP_ALERT";

// Global HAL singleton instance
SensorHAL sensorHAL;

// MPU6050 Registers
#define MPU_REG_PWR_MGMT_1    0x6B
#define MPU_REG_ACCEL_CONFIG  0x1C
#define MPU_REG_ACCEL_XOUT_H  0x3B
#define MPU_REG_TEMP_OUT_H    0x41
#define MPU_REG_WHO_AM_I      0x75

// BME688 Registers
#define BME688_REG_CHIP_ID    0xD0
#define BME688_REG_RESET      0xE0
#define BME688_REG_CTRL_GAS_1 0x71
#define BME688_REG_CTRL_HUM   0x72
#define BME688_REG_CTRL_MEAS  0x73
#define BME688_REG_CONFIG     0x74
#define BME688_REG_FIELD_0    0x1D

// BME688 Calibration struct
struct BME688Calib {
  uint16_t par_t1;
  int16_t  par_t2;
  int8_t   par_t3;
  uint16_t par_p1;
  int16_t  par_p2;
  int8_t   par_p3;
  int16_t  par_p4;
  int16_t  par_p5;
  int8_t   par_p7;
  int8_t   par_p6;
  int16_t  par_p8;
  int16_t  par_p9;
  uint8_t  par_p10;
  uint16_t par_h1;
  uint16_t par_h2;
  int8_t   par_h3;
  int8_t   par_h4;
  int8_t   par_h5;
  uint8_t  par_h6;
  int8_t   par_h7;
  int8_t   par_gh1;
  int16_t  par_gh2;
  int8_t   par_gh3;
  int32_t  t_fine;
} g_bmeCalib;

SensorHAL::SensorHAL()
  : _initialized(false),
    _bmeAvailable(false),
    _bmeWarming(true),
    _mpuAvailable(false),
    _mqAvailable(false),
    _batteryAvailable(false),
    _bmeI2cAddress(BME688_I2C_ADDR_DEFAULT),
    _mpuI2cAddress(MPU6050_I2C_ADDR),
    _batteryGaugeType(255),
    _gaugeI2cAddress(0),
    _mqRo(MQ7_RO_CLEAN_AIR),
    _bootTimeMs(0),
    _bmeWarmupStartMs(0),
    _fallDetector(FALL_FREE_FALL_G, FALL_IMPACT_G, FALL_INACTIVITY_MS),
    _sosPressedEvent(false) {
}

bool SensorHAL::begin() {
  _bootTimeMs = millis();
  _bmeWarmupStartMs = millis();

  // 1. Configure Actuators & Discrete Inputs
  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);

  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  pinMode(PIN_SOS_BUTTON, INPUT_PULLUP);
#if defined(PIN_ACK_BUTTON) && (PIN_ACK_BUTTON >= 0)
  pinMode(PIN_ACK_BUTTON, INPUT_PULLUP);
#endif
  pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);

  // If Feather STEMMA QT power pin is defined, energize I2C bus sensors
#if defined(PIN_I2C_POWER) && (PIN_I2C_POWER >= 0)
  pinMode(PIN_I2C_POWER, OUTPUT);
  digitalWrite(PIN_I2C_POWER, HIGH);
  delay(10);
#endif

  // 2. Configure ESP32 ADC for Analog Inputs (classic/generic profiles only)
#if defined(PIN_GAS_ANALOG) && (PIN_GAS_ANALOG >= 0)
  pinMode(PIN_GAS_ANALOG, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_GAS_ANALOG, ADC_11db);
#endif
#if defined(PIN_BATTERY_ADC) && (PIN_BATTERY_ADC >= 0)
  pinMode(PIN_BATTERY_ADC, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_BATTERY_ADC, ADC_11db);
#endif

  ESP_LOGI(SENSOR_TAG, "Initializing hardware; profile=%d simulated=%u",
           ACTIVE_HARDWARE_PROFILE, static_cast<unsigned>(SIMULATE_SENSORS));

  // 3. Initialize I2C Bus with Safe Timeout
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setTimeOut(50); // 50ms safety timeout prevents bus lockup if lines are open

  // 4. Probe Battery Fuel Gauge on Feather S3
  if (initBatteryGauge()) {
    _batteryAvailable = true;
  } else {
#if defined(PIN_BATTERY_ADC) && (PIN_BATTERY_ADC >= 0)
    int battRaw = analogRead(PIN_BATTERY_ADC);
    float testVolt = (battRaw / 4095.0f) * 3.3f * BATTERY_DIVIDER_RATIO * BATTERY_ADC_CALIBRATION;
    if (testVolt >= 2.0f && testVolt <= 5.0f) {
      _batteryAvailable = true;
      _batteryGaugeType = 0; // Divider
      ESP_LOGI(POWER_TAG, "Battery divider available; gpio=%d", PIN_BATTERY_ADC);
    } else {
      _batteryAvailable = false;
      _batteryGaugeType = 255;
    }
#else
    _batteryAvailable = false;
    _batteryGaugeType = 255;
    ESP_LOGW(POWER_TAG, "Battery gauge unavailable");
#endif
  }

  // 5. Probe BME688 Environmental Sensor
  if (probeI2CDevice(BME688_I2C_ADDR_DEFAULT)) {
    _bmeI2cAddress = BME688_I2C_ADDR_DEFAULT;
    _bmeAvailable = initBME688();
  } else if (probeI2CDevice(BME688_I2C_ADDR_ALT)) {
    _bmeI2cAddress = BME688_I2C_ADDR_ALT;
    _bmeAvailable = initBME688();
  } else {
    _bmeAvailable = false;
    ESP_LOGW(SENSOR_TAG, "BME688 unavailable on I2C bus");
  }

  // 6. Probe MPU6050 IMU
  if (probeI2CDevice(MPU6050_I2C_ADDR)) {
    _mpuI2cAddress = MPU6050_I2C_ADDR;
    _mpuAvailable = initMPU6050();
  } else if (probeI2CDevice(MPU6050_I2C_ADDR_ALT)) {
    _mpuI2cAddress = MPU6050_I2C_ADDR_ALT;
    _mpuAvailable = initMPU6050();
  } else {
    _mpuAvailable = false;
    ESP_LOGW(IMU_TAG, "MPU6050 unavailable on I2C bus");
  }

  // 7. Probe Legacy MQ Gas Sensor if on analog profile
#if defined(PIN_GAS_ANALOG) && (PIN_GAS_ANALOG >= 0)
  int mqRaw = analogRead(PIN_GAS_ANALOG);
  if (mqRaw > 30 && mqRaw < 4080) {
    _mqAvailable = true;
    ESP_LOGI(SENSOR_TAG, "MQ-7 analog input available; gpio=%d", PIN_GAS_ANALOG);
  } else {
    _mqAvailable = false;
  }
#else
  _mqAvailable = false;
#endif

  _initialized = true;
  printDiagnostics();

  // Indicate successful HAL boot via short double LED flash
  digitalWrite(PIN_STATUS_LED, HIGH);
  delay(50);
  digitalWrite(PIN_STATUS_LED, LOW);
  delay(50);
  digitalWrite(PIN_STATUS_LED, HIGH);
  delay(50);
  digitalWrite(PIN_STATUS_LED, LOW);

  Serial.flush();
  return true;
}

bool SensorHAL::probeI2CDevice(uint8_t addr) {
  Wire.beginTransmission(addr);
  return (Wire.endTransmission() == 0);
}

bool SensorHAL::initBatteryGauge() {
  // Check MAX17048 at 0x36
  if (probeI2CDevice(MAX17048_I2C_ADDR)) {
    _batteryGaugeType = 1; // MAX17048
    _gaugeI2cAddress = MAX17048_I2C_ADDR;
    ESP_LOGI(POWER_TAG, "MAX17048 fuel gauge detected");
    return true;
  }
  // Check LC709203F at 0x0B
  if (probeI2CDevice(LC709203F_I2C_ADDR)) {
    _batteryGaugeType = 2; // LC709203F
    _gaugeI2cAddress = LC709203F_I2C_ADDR;
    ESP_LOGI(POWER_TAG, "LC709203F fuel gauge detected");
    return true;
  }
  return false;
}

bool SensorHAL::readBatteryGauge(float &volts, float &pct) {
  if (_batteryGaugeType == 1) { // MAX17048
    Wire.beginTransmission(_gaugeI2cAddress);
    Wire.write(0x02); // VCELL register
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(_gaugeI2cAddress, (uint8_t)2) < 2) return false;
    uint16_t vcell = (Wire.read() << 8) | Wire.read();
    volts = (float)vcell * 78.125e-6f;

    Wire.beginTransmission(_gaugeI2cAddress);
    Wire.write(0x04); // SOC register
    if (Wire.endTransmission(false) == 0 && Wire.requestFrom(_gaugeI2cAddress, (uint8_t)2) >= 2) {
      uint16_t soc = (Wire.read() << 8) | Wire.read();
      pct = constrain((float)soc / 256.0f, 0.0f, 100.0f);
    } else {
      pct = constrain(((volts - BATTERY_VOLTAGE_EMPTY) / (BATTERY_VOLTAGE_FULL - BATTERY_VOLTAGE_EMPTY)) * 100.0f, 0.0f, 100.0f);
    }
    return (volts >= 2.0f && volts <= 4.5f);
  } else if (_batteryGaugeType == 2) { // LC709203F
    Wire.beginTransmission(_gaugeI2cAddress);
    Wire.write(0x09); // Cell Voltage mV
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(_gaugeI2cAddress, (uint8_t)2) < 2) return false;
    uint16_t mv = Wire.read() | (Wire.read() << 8);
    volts = (float)mv / 1000.0f;

    Wire.beginTransmission(_gaugeI2cAddress);
    Wire.write(0x0D); // SOC %
    if (Wire.endTransmission(false) == 0 && Wire.requestFrom(_gaugeI2cAddress, (uint8_t)2) >= 2) {
      uint16_t soc = Wire.read() | (Wire.read() << 8);
      pct = constrain((float)soc, 0.0f, 100.0f);
    } else {
      pct = constrain(((volts - BATTERY_VOLTAGE_EMPTY) / (BATTERY_VOLTAGE_FULL - BATTERY_VOLTAGE_EMPTY)) * 100.0f, 0.0f, 100.0f);
    }
    return (volts >= 2.0f && volts <= 4.5f);
  }
  return false;
}

bool SensorHAL::initBME688() {
  Wire.beginTransmission(_bmeI2cAddress);
  Wire.write(BME688_REG_CHIP_ID);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(_bmeI2cAddress, (uint8_t)1) < 1) return false;
  uint8_t chipId = Wire.read();
  if (chipId != 0x61) {
    ESP_LOGW(SENSOR_TAG, "BME688 chip ID mismatch; id=0x%02X", static_cast<unsigned>(chipId));
    return false;
  }

  // Soft reset
  Wire.beginTransmission(_bmeI2cAddress);
  Wire.write(BME688_REG_RESET);
  Wire.write(0xB6);
  Wire.endTransmission();
  delay(10);

  // Read calibration data (simplified coefficients from 0x8A..0xA1)
  Wire.beginTransmission(_bmeI2cAddress);
  Wire.write(0x8A);
  if (Wire.endTransmission(false) == 0 && Wire.requestFrom(_bmeI2cAddress, (uint8_t)24) >= 24) {
    g_bmeCalib.par_t1 = Wire.read() | (Wire.read() << 8);
    g_bmeCalib.par_t2 = (int16_t)(Wire.read() | (Wire.read() << 8));
    g_bmeCalib.par_t3 = (int8_t)Wire.read();
    g_bmeCalib.par_p1 = Wire.read() | (Wire.read() << 8);
    g_bmeCalib.par_p2 = (int16_t)(Wire.read() | (Wire.read() << 8));
    g_bmeCalib.par_p3 = (int8_t)Wire.read();
    g_bmeCalib.par_p4 = (int16_t)(Wire.read() | (Wire.read() << 8));
    g_bmeCalib.par_p5 = (int16_t)(Wire.read() | (Wire.read() << 8));
    g_bmeCalib.par_p7 = (int8_t)Wire.read();
    g_bmeCalib.par_p6 = (int8_t)Wire.read();
    g_bmeCalib.par_p8 = (int16_t)(Wire.read() | (Wire.read() << 8));
    g_bmeCalib.par_p9 = (int16_t)(Wire.read() | (Wire.read() << 8));
    g_bmeCalib.par_p10 = Wire.read();
  }

  // Configure oversampling: humidity 1x (0x01)
  Wire.beginTransmission(_bmeI2cAddress);
  Wire.write(BME688_REG_CTRL_HUM);
  Wire.write(0x01);
  Wire.endTransmission();

  // Configure temperature 2x, pressure 4x, forced mode 0x01
  Wire.beginTransmission(_bmeI2cAddress);
  Wire.write(BME688_REG_CTRL_MEAS);
  Wire.write((0x02 << 5) | (0x03 << 2) | 0x01);
  Wire.endTransmission();

  // Configure gas heater: enable gas conversion (0x20 in ctrl_gas_1)
  Wire.beginTransmission(_bmeI2cAddress);
  Wire.write(BME688_REG_CTRL_GAS_1);
  Wire.write(0x20);
  Wire.endTransmission();

  ESP_LOGI(SENSOR_TAG, "BME688 initialized; i2c=0x%02X", static_cast<unsigned>(_bmeI2cAddress));
  return true;
}

bool SensorHAL::readBME688(float &temp, float &hum, float &press, float &gasRes, bool &warming, bool &gasValid) {
  if (!_bmeAvailable) return false;

  // Read field registers starting at 0x1D
  Wire.beginTransmission(_bmeI2cAddress);
  Wire.write(BME688_REG_FIELD_0);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(_bmeI2cAddress, (uint8_t)17) < 17) return false;

  uint8_t status = Wire.read();
  (void)status;
  Wire.read(); // reserved
  uint32_t pressRaw = ((uint32_t)Wire.read() << 12) | ((uint32_t)Wire.read() << 4) | (Wire.read() >> 4);
  uint32_t tempRaw = ((uint32_t)Wire.read() << 12) | ((uint32_t)Wire.read() << 4) | (Wire.read() >> 4);
  uint16_t humRaw = ((uint16_t)Wire.read() << 8) | Wire.read();
  Wire.read(); Wire.read(); Wire.read(); Wire.read(); Wire.read(); // reserved
  uint8_t gasStatus = Wire.read();
  uint8_t gasResLsb = Wire.read();
  uint8_t gasResMsb = Wire.read();

  // Calculate temperature in Celsius using calibration
  float var1 = (((float)tempRaw / 16384.0f) - ((float)g_bmeCalib.par_t1 / 1024.0f)) * (float)g_bmeCalib.par_t2;
  float var2 = ((((float)tempRaw / 131072.0f) - ((float)g_bmeCalib.par_t1 / 8192.0f)) *
                (((float)tempRaw / 131072.0f) - ((float)g_bmeCalib.par_t1 / 8192.0f))) *
               ((float)g_bmeCalib.par_t3 * 16.0f);
  g_bmeCalib.t_fine = (int32_t)(var1 + var2);
  temp = (var1 + var2) / 5120.0f;
  if (temp < -40.0f || temp > 85.0f || isnan(temp)) temp = 25.0f;

  // Calculate barometric pressure in Pascals
  var1 = ((float)g_bmeCalib.t_fine / 2.0f) - 64000.0f;
  var2 = var1 * var1 * ((float)g_bmeCalib.par_p6 / (131072.0f));
  var2 = var2 + (var1 * (float)g_bmeCalib.par_p5 * 2.0f);
  var2 = (var2 / 4.0f) + ((float)g_bmeCalib.par_p4 * 65536.0f);
  var1 = (((float)g_bmeCalib.par_p3 * var1 * var1) / 16384.0f + ((float)g_bmeCalib.par_p2 * var1)) / 524288.0f;
  var1 = (1.0f + var1 / 32768.0f) * (float)g_bmeCalib.par_p1;
  if (var1 != 0.0f) {
    float p = 1048576.0f - (float)pressRaw;
    p = ((p - (var2 / 4096.0f)) * 6250.0f) / var1;
    var1 = ((float)g_bmeCalib.par_p9 * p * p) / 2147483648.0f;
    var2 = p * ((float)g_bmeCalib.par_p8) / 32768.0f;
    press = p + (var1 + var2 + ((float)g_bmeCalib.par_p7)) / 16.0f;
  } else {
    press = 101325.0f;
  }
  if (press < 30000.0f || press > 120000.0f || isnan(press)) press = 101325.0f;

  // Humidity calculation (percentage)
  hum = constrain(humRaw * 0.005f + 40.0f, 10.0f, 99.0f);

  // Gas resistance reading
  uint16_t gasRaw = ((uint16_t)gasResMsb << 2) | (gasResLsb >> 6);
  gasValid = (gasStatus & 0x20) != 0;
  bool heatStab = (gasStatus & 0x10) != 0;
  warming = !heatStab || (millis() - _bmeWarmupStartMs < 30000); // 30s initial warmup
  _bmeWarming = warming;

  // Compute resistance in ohms
  if (gasRaw > 0 && gasRaw < 1023) {
    gasRes = 100000.0f * (1023.0f - (float)gasRaw) / (float)gasRaw;
  } else {
    gasRes = 50000.0f;
  }

  // Trigger next forced-mode conversion
  Wire.beginTransmission(_bmeI2cAddress);
  Wire.write(BME688_REG_CTRL_MEAS);
  Wire.write((0x02 << 5) | (0x03 << 2) | 0x01);
  Wire.endTransmission();

  return true;
}

bool SensorHAL::initMPU6050() {
  Wire.beginTransmission(_mpuI2cAddress);
  Wire.write(MPU_REG_WHO_AM_I);
  if (Wire.endTransmission(false) != 0) return false;
  Wire.requestFrom(_mpuI2cAddress, (uint8_t)1);
  if (!Wire.available()) return false;
  uint8_t whoAmI = Wire.read();
  if (whoAmI != 0x68 && whoAmI != 0x69 && whoAmI != 0x70) {
    ESP_LOGW(IMU_TAG, "MPU6050 identity mismatch; id=0x%02X", static_cast<unsigned>(whoAmI));
    return false;
  }

  Wire.beginTransmission(_mpuI2cAddress);
  Wire.write(MPU_REG_PWR_MGMT_1);
  Wire.write(0x00); // Wake up
  if (Wire.endTransmission() != 0) return false;

  Wire.beginTransmission(_mpuI2cAddress);
  Wire.write(MPU_REG_ACCEL_CONFIG);
  Wire.write(0x08); // +/- 4g (8192 LSB/g)
  if (Wire.endTransmission() != 0) return false;

  ESP_LOGI(IMU_TAG, "MPU6050 initialized; i2c=0x%02X range_g=4", static_cast<unsigned>(_mpuI2cAddress));
  return true;
}

bool SensorHAL::readMPU6050(float &ax, float &ay, float &az, float &temp) {
  if (!_mpuAvailable) return false;

  Wire.beginTransmission(_mpuI2cAddress);
  Wire.write(MPU_REG_ACCEL_XOUT_H);
  if (Wire.endTransmission(false) != 0) return false;

  if (Wire.requestFrom(_mpuI2cAddress, (uint8_t)8) < 8) return false;
  int16_t rawAx = (Wire.read() << 8) | Wire.read();
  int16_t rawAy = (Wire.read() << 8) | Wire.read();
  int16_t rawAz = (Wire.read() << 8) | Wire.read();
  int16_t rawTemp = (Wire.read() << 8) | Wire.read();

  ax = (float)rawAx / 8192.0f;
  ay = (float)rawAy / 8192.0f;
  az = (float)rawAz / 8192.0f;
  temp = ((float)rawTemp / 340.0f) + 36.53f;
  return true;
}

bool SensorHAL::updateEmergencyInputs(uint32_t now) {
  bool rawSos = (digitalRead(PIN_SOS_BUTTON) == LOW);
  bool sosTriggered = _sosButton.update(now, rawSos);
  if (sosTriggered) {
    _sosPressedEvent = true;
    _alarms.raise(Safety::Sos);
    refreshAlarmIndication();
    ESP_LOGW(ALERT_TAG, "Physical SOS press confirmed");
  }

#if defined(PIN_ACK_BUTTON) && (PIN_ACK_BUTTON >= 0)
  bool rawAck = (digitalRead(PIN_ACK_BUTTON) == LOW);
  _ackButton.update(now, rawAck);
#endif

  return sosTriggered;
}

uint8_t SensorHAL::checkAlarmAcknowledge(uint32_t now) {
#if defined(PIN_ACK_BUTTON) && (PIN_ACK_BUTTON >= 0)
  bool ackHeld = (digitalRead(PIN_ACK_BUTTON) == LOW);
  uint8_t cleared = _alarms.acknowledge(now, ackHeld);
  if (cleared != 0) {
    refreshAlarmIndication();
    ESP_LOGI(ALERT_TAG, "Local acknowledgement hold confirmed; cleared_mask=0x%02X", static_cast<unsigned>(cleared));
  }
  return cleared;
#else
  (void)now;
  return 0;
#endif
}

bool SensorHAL::checkPanicButton() {
  bool triggered = _sosPressedEvent;
  _sosPressedEvent = false;
  return triggered;
}

void SensorHAL::raiseAlarm(Safety::Alarm alarm) {
  _alarms.raise(alarm);
  refreshAlarmIndication();
}

void SensorHAL::refreshAlarmIndication() {
  unsigned sev = _alarms.severity();
  if (sev >= 3) {
    setAlarmIndication(true, SEVERITY_CRITICAL);
  } else if (sev == 2) {
    setAlarmIndication(true, SEVERITY_WARNING);
  } else {
    setAlarmIndication(false, SEVERITY_NONE);
  }
}

void SensorHAL::setAlarmIndication(bool active, AlertSeverity severity) {
  if (!active) {
    digitalWrite(PIN_STATUS_LED, LOW);
    digitalWrite(PIN_BUZZER, LOW);
    return;
  }
  if (severity == SEVERITY_CRITICAL) {
    digitalWrite(PIN_STATUS_LED, HIGH);
    digitalWrite(PIN_BUZZER, HIGH);
  } else {
    digitalWrite(PIN_STATUS_LED, HIGH);
    digitalWrite(PIN_BUZZER, LOW);
  }
}

void SensorHAL::resetFallFlag() {
  _fallDetector.reset();
  ESP_LOGD(IMU_TAG, "Fall detector reset");
}

float SensorHAL::readGasSensor(bool &healthy) {
#if defined(PIN_GAS_ANALOG) && (PIN_GAS_ANALOG >= 0)
  if (!_mqAvailable) { healthy = false; return 0.0f; }
  uint32_t adcSum = 0;
  for (int i = 0; i < 8; i++) { adcSum += analogRead(PIN_GAS_ANALOG); delayMicroseconds(250); }
  float adcAvg = (float)adcSum / 8.0f;
  if (adcAvg < 20.0f || adcAvg > 4080.0f) { healthy = false; return 0.0f; }
  float vOut = (adcAvg / 4095.0f) * MQ7_VREF;
  if (vOut <= 0.05f) { healthy = false; return 0.0f; }
  float rs = ((MQ7_VREF - vOut) / vOut) * MQ7_RL_VALUE;
  float ratio = rs / _mqRo;
  if (ratio <= 0.01f) ratio = 0.01f;
  float ppm = MQ7_CURVE_A * powf(ratio, MQ7_CURVE_B);
  healthy = true;
  return constrain(ppm, 0.0f, 1000.0f);
#else
  healthy = false;
  return 0.0f;
#endif
}

float SensorHAL::readBatteryDivider(bool &healthy) {
#if defined(PIN_BATTERY_ADC) && (PIN_BATTERY_ADC >= 0)
  if (!_batteryAvailable) { healthy = false; return BATTERY_VOLTAGE_NOMINAL; }
  uint32_t adcSum = 0;
  for (int i = 0; i < 8; i++) { adcSum += analogRead(PIN_BATTERY_ADC); delayMicroseconds(250); }
  float adcAvg = (float)adcSum / 8.0f;
  float vPin = (adcAvg / 4095.0f) * 3.3f * BATTERY_ADC_CALIBRATION;
  float vBatt = vPin * BATTERY_DIVIDER_RATIO;
  healthy = (vBatt >= 2.5f && vBatt <= 4.5f);
  return healthy ? vBatt : BATTERY_VOLTAGE_NOMINAL;
#else
  healthy = false;
  return BATTERY_VOLTAGE_NOMINAL;
#endif
}

void SensorHAL::calibrateMqZero(float customRo) {
#if defined(PIN_GAS_ANALOG) && (PIN_GAS_ANALOG >= 0)
  if (customRo > 100.0f) { _mqRo = customRo; return; }
  int mqRaw = analogRead(PIN_GAS_ANALOG);
  float vOut = (mqRaw / 4095.0f) * MQ7_VREF;
  if (vOut > 0.05f && vOut < 3.25f) {
    float rsAir = ((MQ7_VREF - vOut) / vOut) * MQ7_RL_VALUE;
    _mqRo = rsAir / 27.0f;
  }
#else
  (void)customRo;
#endif
}

SensorReadings SensorHAL::generateFallbackReadings() {
  SensorReadings r;
  r.co_ppm = 0.0f;
  r.temp_c = 26.5f + (float)random(-10, 10) / 10.0f;
  r.humidity_pct = 75.0f + (float)random(0, 50) / 10.0f;
  r.pressure_pa = 101325.0f;
  r.gas_resistance_ohm = 45000.0f;
  r.bme_healthy = _bmeAvailable;
  r.bme_warming = false;
  r.bme_gas_valid = true;
  r.bme_heater_stable = true;
  r.fall_detected = (_alarms.active() & Safety::Fall) != 0;
  r.battery_v = 3.82f;
  r.battery_pct = 80.0f;
  r.battery_gauge_type = _batteryGaugeType;
  r.battery_healthy = _batteryAvailable;
  r.accel_x = 0.01f;
  r.accel_y = 0.01f;
  r.accel_z = 0.99f;
  r.accel_magnitude = 1.00f;
  r.imu_temp_c = 28.0f;
  r.mq_healthy = _mqAvailable;
  r.mpu_healthy = _mpuAvailable;
  r.sensor_ok = false;
  r.is_simulated = true;
  r.panic_pressed = false;
  r.ack_pressed = false;
  r.active_alarms = _alarms.active();
  r.alarm_severity = _alarms.severity();
  strncpy(r.status_message, "Operating in Resilient Simulation Fallback Mode", sizeof(r.status_message) - 1);
  return r;
}

SensorReadings SensorHAL::read() {
  if (SIMULATE_SENSORS) {
    return generateFallbackReadings();
  }

  if (!_mpuAvailable && !_bmeAvailable && !_mqAvailable && !_batteryAvailable && SENSOR_AUTO_DETECT) {
    return generateFallbackReadings();
  }

  SensorReadings r;
  r.is_simulated = false;
  r.panic_pressed = false; // Never consumed by telemetry polling
  r.ack_pressed = false;

  // 1. Environmental Sensor (BME688)
  if (_bmeAvailable) {
    bool warming = false, gasValid = false;
    bool bmeOk = readBME688(r.temp_c, r.humidity_pct, r.pressure_pa, r.gas_resistance_ohm, warming, gasValid);
    r.bme_healthy = bmeOk;
    r.bme_warming = warming;
    r.bme_gas_valid = gasValid;
    r.bme_heater_stable = !warming;
    r.co_ppm = 0.0f; // BME688 NEVER populates CO
  } else if (_mqAvailable) {
    // Legacy MQ-7
    bool mqOk = false;
    r.co_ppm = readGasSensor(mqOk);
    r.mq_healthy = mqOk;
    r.bme_healthy = false;
    r.temp_c = 25.0f;
    r.humidity_pct = 75.0f;
    r.pressure_pa = 101325.0f;
    r.gas_resistance_ohm = 0.0f;
  } else {
    r.co_ppm = 0.0f;
    r.temp_c = 25.0f;
    r.humidity_pct = 75.0f;
    r.pressure_pa = 101325.0f;
    r.gas_resistance_ohm = 0.0f;
    r.bme_healthy = false;
    r.mq_healthy = false;
  }

  // 2. Motion IMU (MPU6050) & Fall Detection
  float ax = 0, ay = 0, az = 1.0f, mpuTemp = 25.0f;
  bool mpuOk = readMPU6050(ax, ay, az, mpuTemp);
  r.mpu_healthy = mpuOk;
  r.accel_x = ax;
  r.accel_y = ay;
  r.accel_z = az;
  r.accel_magnitude = sqrtf(ax * ax + ay * ay + az * az);
  r.imu_temp_c = mpuOk ? mpuTemp : 25.0f; // Separate from environmental temperature

  // Run fall detection state machine
  uint32_t now = millis();
  if (mpuOk) {
    bool fallConfirmed = _fallDetector.update(now, r.accel_magnitude, true);
    if (fallConfirmed) {
      _alarms.raise(Safety::Fall);
      refreshAlarmIndication();
      ESP_LOGW(ALERT_TAG, "Man-down condition confirmed");
    }
  }
  r.fall_detected = (_alarms.active() & Safety::Fall) != 0;

  // 3. Battery Measurement
  r.battery_gauge_type = _batteryGaugeType;
  if (_batteryGaugeType == 1 || _batteryGaugeType == 2) {
    float v = 0.0f, pct = 0.0f;
    bool battOk = readBatteryGauge(v, pct);
    r.battery_v = v;
    r.battery_pct = pct;
    r.battery_healthy = battOk;
  } else if (_batteryGaugeType == 0) {
    bool battOk = false;
    r.battery_v = readBatteryDivider(battOk);
    r.battery_healthy = battOk;
    r.battery_pct = constrain(((r.battery_v - BATTERY_VOLTAGE_EMPTY) /
                              (BATTERY_VOLTAGE_FULL - BATTERY_VOLTAGE_EMPTY)) * 100.0f, 0.0f, 100.0f);
  } else {
    r.battery_healthy = false;
    r.battery_v = NAN;
    r.battery_pct = NAN;
  }

  // Active alarms & severity
  r.active_alarms = _alarms.active();
  r.alarm_severity = _alarms.severity();

  // Overall system health
  r.sensor_ok = (_bmeAvailable ? r.bme_healthy : r.mq_healthy) &&
                (r.mpu_healthy || !_mpuAvailable) &&
                (r.battery_healthy || !_batteryAvailable);

  if (_bmeAvailable && r.bme_healthy) {
    strncpy(r.status_message, r.bme_warming ? "BME688 active (gas sensor conditioning)" : "BME688 & IMU nominal", sizeof(r.status_message) - 1);
  } else {
    strncpy(r.status_message, "Sensors operating in degraded/fallback mode", sizeof(r.status_message) - 1);
  }

  return r;
}

void SensorHAL::printDiagnostics() {
  Serial.println("\n--------------------------------------------------------------");
  Serial.println("           COMPALLETTE HARDWARE ABSTRACTION LAYER DIAGNOSTICS ");
  Serial.println("--------------------------------------------------------------");
  Serial.printf("  Hardware Mode        : %s\n", SIMULATE_SENSORS ? "FORCED SYNTHETIC" : "PHYSICAL SAMPLING");
  Serial.printf("  Profile ID           : %d\n", ACTIVE_HARDWARE_PROFILE);
  Serial.printf("  BME688 Envr Sensor   : %s (I2C: 0x%02X, SDA=%d, SCL=%d)\n",
                _bmeAvailable ? "ONLINE (Healthy)" : "NOT FOUND",
                _bmeI2cAddress, PIN_I2C_SDA, PIN_I2C_SCL);
  Serial.printf("  MPU6050 6-Axis IMU   : %s (I2C Addr: 0x%02X)\n",
                _mpuAvailable ? "ONLINE (Healthy)" : "NOT FOUND",
                _mpuI2cAddress);
  Serial.printf("  Battery Monitor      : Gauge Type %d, Healthy: %s\n",
                _batteryGaugeType, _batteryAvailable ? "YES" : "NO");
  Serial.printf("  SOS Panic Button     : READY (GPIO %d, Active LOW)\n", PIN_SOS_BUTTON);
#if defined(PIN_ACK_BUTTON) && (PIN_ACK_BUTTON >= 0)
  Serial.printf("  Acknowledge Button   : READY (GPIO %d, 2s Hold To Ack)\n", PIN_ACK_BUTTON);
#endif
  Serial.printf("  Emergency Strobe/Buzz: READY (LED=%d, Buzzer=%d)\n", PIN_STATUS_LED, PIN_BUZZER);
  Serial.println("--------------------------------------------------------------\n");
  Serial.flush();
}
