use crate::auth::ApiKey;
use crate::models::WireEnvelope;
use rocket::serde::json::{json, Json, Value};
use rocket::State;
use sqlx::PgPool;
use std::time::{SystemTime, UNIX_EPOCH};

#[post("/api/v1/telemetry", data = "<data>")]
pub async fn ingest_telemetry(
    _api_key: ApiKey,
    pool: &State<PgPool>,
    data: Json<WireEnvelope>,
) -> Value {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let env = data.into_inner();

    // Support both standard wire protocol and legacy envelopes
    let node_id = env
        .sender
        .clone()
        .or(env.miner_id.clone())
        .unwrap_or_else(|| "UNKNOWN".to_string());
    let seq = env.seq as i32;
    let role = env.role.unwrap_or_else(|| "WEARABLE".to_string());
    let zone = env.zone.unwrap_or_else(|| "UNASSIGNED".to_string());
    let uptime_ms = env.uptime.unwrap_or(0) as i64;

    let (co_ppm, temp_c, hum, fall, batt, sim, sok) = if let Some(p) = env.payload {
        (
            p.co_val(),
            p.temp_val(),
            p.hum_val(),
            p.fall_val(),
            p.batt_val(),
            p.sim_val(),
            p.ok_val(),
        )
    } else {
        (
            env.co.unwrap_or(0.0),
            0.0,
            0.0,
            env.fall.unwrap_or(false),
            0.0,
            true,
            true,
        )
    };

    // 1. Check for deduplication
    let existing: Option<(i64,)> = sqlx::query_as(
        r#"
        SELECT id FROM mining_api_telemetryrecord
        WHERE node_id = $1 AND seq = $2
        "#,
    )
    .bind(&node_id)
    .bind(seq)
    .fetch_optional(pool.inner())
    .await
    .unwrap_or(None);

    if existing.is_some() {
        return json!({
            "status": "ok",
            "recorded": false,
            "deduplicated": true,
            "node_id": node_id,
            "seq": seq
        });
    }

    // 2. Upsert Node state
    let _ = sqlx::query(
        r#"
        INSERT INTO mining_api_node (
            node_id, role, current_zone, last_seen_ts, last_seq,
            battery_v, free_heap, status, is_simulated, sensor_ok,
            latest_co, latest_temp, latest_hum, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 0, 'ONLINE', $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (node_id) DO UPDATE SET
            role = EXCLUDED.role,
            current_zone = EXCLUDED.current_zone,
            last_seen_ts = EXCLUDED.last_seen_ts,
            last_seq = EXCLUDED.last_seq,
            battery_v = EXCLUDED.battery_v,
            status = 'ONLINE',
            is_simulated = EXCLUDED.is_simulated,
            sensor_ok = EXCLUDED.sensor_ok,
            latest_co = EXCLUDED.latest_co,
            latest_temp = EXCLUDED.latest_temp,
            latest_hum = EXCLUDED.latest_hum,
            updated_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(&node_id)
    .bind(&role)
    .bind(&zone)
    .bind(now_ms)
    .bind(seq)
    .bind(batt)
    .bind(sim)
    .bind(sok)
    .bind(co_ppm)
    .bind(temp_c)
    .bind(hum)
    .execute(pool.inner())
    .await;

    // 3. Insert Telemetry record
    let _ = sqlx::query(
        r#"
        INSERT INTO mining_api_telemetryrecord (
            node_id, seq, zone, co_ppm, temp_c, humidity_pct,
            fall_detected, battery_v, is_simulated, sensor_ok,
            uptime_ms, received_at, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
        ON CONFLICT (node_id, seq) DO NOTHING
        "#,
    )
    .bind(&node_id)
    .bind(seq)
    .bind(&zone)
    .bind(co_ppm)
    .bind(temp_c)
    .bind(hum)
    .bind(fall)
    .bind(batt)
    .bind(sim)
    .bind(sok)
    .bind(uptime_ms)
    .bind(now_ms)
    .execute(pool.inner())
    .await;

    json!({
        "status": "ok",
        "recorded": true,
        "deduplicated": false,
        "node_id": node_id,
        "seq": seq
    })
}
