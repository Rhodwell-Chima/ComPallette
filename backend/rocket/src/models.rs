use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// --- Enums matching Django TextChoices ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum NodeRole {
    WEARABLE,
    ANCHOR,
    GATEWAY,
}

impl NodeRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            NodeRole::WEARABLE => "WEARABLE",
            NodeRole::ANCHOR => "ANCHOR",
            NodeRole::GATEWAY => "GATEWAY",
        }
    }
}

impl Default for NodeRole {
    fn default() -> Self {
        NodeRole::WEARABLE
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum NodeStatus {
    ONLINE,
    STALE,
    OFFLINE,
}

impl NodeStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            NodeStatus::ONLINE => "ONLINE",
            NodeStatus::STALE => "STALE",
            NodeStatus::OFFLINE => "OFFLINE",
        }
    }
}

impl Default for NodeStatus {
    fn default() -> Self {
        NodeStatus::ONLINE
    }
}

// --- Database Entities (matching mining_api_* tables) ---

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Node {
    pub node_id: String,
    pub role: String,
    pub current_zone: String,
    pub last_seen_ts: i64,
    pub last_seq: i32,
    pub battery_v: f64,
    pub free_heap: i32,
    pub status: String,
    pub is_simulated: bool,
    pub sensor_ok: bool,
    pub latest_co: f64,
    pub latest_temp: f64,
    pub latest_hum: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TelemetryRecord {
    pub id: i64,
    pub node_id: String,
    pub seq: i32,
    pub zone: String,
    pub co_ppm: f64,
    pub temp_c: f64,
    pub humidity_pct: f64,
    pub fall_detected: bool,
    pub battery_v: f64,
    pub is_simulated: bool,
    pub sensor_ok: bool,
    pub uptime_ms: i64,
    pub received_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SafetyAlert {
    pub id: i64,
    pub node_id: String,
    pub zone: String,
    pub severity: String,
    pub alert_code: String,
    pub details: String,
    pub trigger_value: f64,
    pub status: String,
    pub seq: i32,
    pub created_at: i64,
    pub acknowledged_at: Option<i64>,
    pub acknowledged_by: Option<String>,
    pub resolved_at: Option<i64>,
    pub resolved_by: Option<String>,
    pub resolution_notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AuditEntry {
    pub id: i64,
    pub timestamp: i64,
    pub actor: String,
    pub action: String,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ProvisioningRequest {
    pub chip_id: String,
    pub chip_mac: String,
    pub mesh_node_id: i64,
    pub fw_version: String,
    pub battery_v: f64,
    pub mq_healthy: bool,
    pub mpu_healthy: bool,
    pub status: String,
    pub assigned_id: String,
    pub assigned_role: String,
    pub assigned_zone: String,
    pub assigned_by: String,
}

// --- Wire Envelopes and Payloads ---

#[derive(Debug, Deserialize, Serialize)]
pub struct TelemetryPayload {
    #[serde(default)]
    pub co: Option<f64>,
    #[serde(default)]
    pub co_ppm: Option<f64>,
    #[serde(default)]
    pub temp: Option<f64>,
    #[serde(default)]
    pub temp_c: Option<f64>,
    #[serde(default)]
    pub hum: Option<f64>,
    #[serde(default)]
    pub humidity_pct: Option<f64>,
    #[serde(default)]
    pub fall: Option<bool>,
    #[serde(default)]
    pub fall_detected: Option<bool>,
    #[serde(default)]
    pub batt: Option<f64>,
    #[serde(default)]
    pub battery_v: Option<f64>,
    #[serde(default)]
    pub sim: Option<bool>,
    #[serde(default)]
    pub is_simulated: Option<bool>,
    #[serde(default)]
    pub ok: Option<bool>,
    #[serde(default)]
    pub sensor_ok: Option<bool>,
}

impl TelemetryPayload {
    pub fn co_val(&self) -> f64 {
        self.co.or(self.co_ppm).unwrap_or(0.0)
    }
    pub fn temp_val(&self) -> f64 {
        self.temp.or(self.temp_c).unwrap_or(0.0)
    }
    pub fn hum_val(&self) -> f64 {
        self.hum.or(self.humidity_pct).unwrap_or(0.0)
    }
    pub fn fall_val(&self) -> bool {
        self.fall.or(self.fall_detected).unwrap_or(false)
    }
    pub fn batt_val(&self) -> f64 {
        self.batt.or(self.battery_v).unwrap_or(0.0)
    }
    pub fn sim_val(&self) -> bool {
        self.sim.or(self.is_simulated).unwrap_or(true)
    }
    pub fn ok_val(&self) -> bool {
        self.ok.or(self.sensor_ok).unwrap_or(true)
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct WireEnvelope {
    #[serde(default = "default_version")]
    pub ver: u32,
    #[serde(default, rename = "type")]
    pub msg_type: String,
    #[serde(default)]
    pub seq: u32,
    #[serde(default)]
    pub sender: Option<String>,
    #[serde(default)]
    pub miner_id: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub zone: Option<String>,
    #[serde(default)]
    pub uptime: Option<u64>,
    #[serde(default)]
    pub payload: Option<TelemetryPayload>,
    // Direct fields for legacy payloads
    #[serde(default)]
    pub co: Option<f64>,
    #[serde(default)]
    pub fall: Option<bool>,
}

fn default_version() -> u32 {
    1
}

// --- Request DTOs ---

#[derive(Debug, Deserialize)]
pub struct AlertAckRequest {
    #[serde(default)]
    pub officer_name: Option<String>,
    #[serde(default)]
    pub officer: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AlertResolveRequest {
    #[serde(default)]
    pub officer_name: Option<String>,
    #[serde(default)]
    pub officer: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ProvisioningAssignRequest {
    pub chip_id: String,
    pub device_id: String,
    #[serde(default = "default_role_str")]
    pub role: String,
    #[serde(default = "default_zone_str")]
    pub zone_id: String,
    #[serde(default = "default_officer_str")]
    pub officer_name: String,
}

fn default_role_str() -> String {
    "WEARABLE".to_string()
}
fn default_zone_str() -> String {
    "SURFACE-PORTAL".to_string()
}
fn default_officer_str() -> String {
    "Safety_Officer".to_string()
}

#[derive(Debug, Deserialize)]
pub struct ProvisioningConfirmRequest {
    pub chip_id: String,
}
