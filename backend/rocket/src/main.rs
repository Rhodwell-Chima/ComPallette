#[macro_use] extern crate rocket;

use rocket::serde::json::{Json, Value};
use rocket::serde::{Deserialize, Serialize};
use rocket::http::Status;
use rocket::request::{self, Request, FromRequest, Outcome};

// --- Custom Header Guard for X-API-Key ---
struct ApiKey(String);

#[rocket::async_trait]
impl<'r> FromRequest<'r> for ApiKey {
    type Error = ();

    async fn from_request(req: &'r Request<'_>) -> Outcome<Self, Self::Error> {
        let expected_key = std::env::var("COMPALLETTE_API_KEY")
            .unwrap_or_else(|_| "compallette-mining-secret-key-v1".to_string());

        match req.headers().get_one("X-API-Key") {
            Some(key) if key == expected_key => Outcome::Success(ApiKey(key.to_string())),
            _ => Outcome::Error((Status::Unauthorized, ())),
        }
    }
}

// --- Wire Envelopes ---
#[derive(Debug, Deserialize, Serialize)]
struct TelemetryPayload {
    #[serde(default)]
    co: f64,
    #[serde(default)]
    temp: f64,
    #[serde(default)]
    hum: f64,
    #[serde(default)]
    fall: bool,
    #[serde(default)]
    batt: f64,
    #[serde(default)]
    sim: bool,
    #[serde(default)]
    ok: bool,
}

#[derive(Debug, Deserialize, Serialize)]
struct WireEnvelope {
    ver: u32,
    #[serde(rename = "type")]
    msg_type: String,
    seq: u32,
    sender: String,
    role: String,
    zone: String,
    uptime: u64,
    payload: TelemetryPayload,
}

// --- Endpoints ---
#[get("/health")]
fn health() -> Value {
    rocket::serde::json::json!({
        "status": "healthy",
        "service": "Compallette Mining Safety Rust/Rocket Backend",
        "version": "2.0.0",
        "engine": "Rocket 0.5.1 (Rust Async)"
    })
}

#[post("/api/v1/telemetry", data = "<data>")]
fn ingest_telemetry(_api_key: ApiKey, data: Json<WireEnvelope>) -> Value {
    rocket::serde::json::json!({
        "status": "ok",
        "recorded": true,
        "deduplicated": false,
        "node_id": data.sender,
        "seq": data.seq
    })
}

#[post("/api/v1/alert", data = "<data>")]
fn ingest_alert(_api_key: ApiKey, data: Json<Value>) -> Value {
    rocket::serde::json::json!({
        "status": "ok",
        "recorded": true,
        "deduplicated": false,
        "alert_id": 1,
        "node_id": data.get("sender").unwrap_or(&Value::Null)
    })
}

#[post("/api/v1/heartbeat", data = "<data>")]
fn ingest_heartbeat(_api_key: ApiKey, data: Json<Value>) -> Value {
    rocket::serde::json::json!({
        "status": "ok",
        "node_id": data.get("sender").unwrap_or(&Value::Null)
    })
}

#[get("/api/v1/system/summary")]
fn system_summary() -> Value {
    rocket::serde::json::json!({
        "total_nodes_tracked": 0,
        "online_miners": 0,
        "stale_nodes": 0,
        "offline_nodes": 0,
        "active_unacknowledged_alerts": 0,
        "critical_emergencies": 0,
        "acknowledged_in_progress": 0,
        "miners_in_gas_warning": 0,
        "miners_in_gas_critical": 0,
        "last_packet_received_ms": 0
    })
}

#[launch]
fn rocket() -> _ {
    rocket::build()
        .mount("/", routes![
            health,
            ingest_telemetry,
            ingest_alert,
            ingest_heartbeat,
            system_summary
        ])
}
