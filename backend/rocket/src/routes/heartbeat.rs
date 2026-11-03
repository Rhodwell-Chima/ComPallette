use crate::auth::ApiKey;
use rocket::serde::json::{json, Json, Value};
use rocket::State;
use sqlx::PgPool;
use std::time::{SystemTime, UNIX_EPOCH};

#[post("/api/v1/heartbeat", data = "<data>")]
pub async fn ingest_heartbeat(
    _api_key: ApiKey,
    pool: &State<PgPool>,
    data: Json<Value>,
) -> Value {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let d = data.into_inner();
    let node_id = d
        .get("sender")
        .or_else(|| d.get("node_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("UNKNOWN")
        .to_string();
    let role = d
        .get("role")
        .and_then(|v| v.as_str())
        .unwrap_or("ANCHOR")
        .to_string();
    let zone = d
        .get("zone")
        .and_then(|v| v.as_str())
        .unwrap_or("UNASSIGNED")
        .to_string();

    let payload = d.get("payload").cloned().unwrap_or(Value::Null);
    let free_heap = payload
        .get("heap")
        .or_else(|| payload.get("free_heap"))
        .or_else(|| d.get("heap"))
        .or_else(|| d.get("free_heap"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;
    let battery_v = payload
        .get("batt")
        .or_else(|| payload.get("battery_v"))
        .or_else(|| d.get("batt"))
        .or_else(|| d.get("battery_v"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let _ = sqlx::query(
        r#"
        INSERT INTO mining_api_node (
            node_id, role, current_zone, last_seen_ts, last_seq,
            battery_v, free_heap, status, is_simulated, sensor_ok,
            latest_co, latest_temp, latest_hum, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, 0, $5, $6, 'ONLINE', FALSE, TRUE, 0.0, 0.0, 0.0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (node_id) DO UPDATE SET
            role = EXCLUDED.role,
            current_zone = EXCLUDED.current_zone,
            last_seen_ts = EXCLUDED.last_seen_ts,
            battery_v = EXCLUDED.battery_v,
            free_heap = EXCLUDED.free_heap,
            status = 'ONLINE',
            updated_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(&node_id)
    .bind(&role)
    .bind(&zone)
    .bind(now_ms)
    .bind(battery_v)
    .bind(free_heap)
    .execute(pool.inner())
    .await;

    json!({
        "status": "ok",
        "node_id": node_id
    })
}
