use crate::models::{Node, TelemetryRecord};
use crate::watchdog::run_watchdog;
use rocket::http::Status;
use rocket::serde::json::{json, Value};
use rocket::State;
use sqlx::PgPool;

#[get("/api/v1/nodes")]
pub async fn list_nodes(pool: &State<PgPool>) -> Value {
    let _ = run_watchdog(pool.inner()).await;

    let nodes: Vec<Node> = sqlx::query_as(
        r#"
        SELECT node_id, role, current_zone, last_seen_ts, last_seq,
               battery_v, free_heap, status, is_simulated, sensor_ok,
               latest_co, latest_temp, latest_hum
        FROM mining_api_node ORDER BY node_id ASC
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .unwrap_or_default();

    let count = nodes.len();
    json!({
        "nodes": nodes,
        "count": count
    })
}

#[get("/api/v1/nodes/<node_id>")]
pub async fn get_node(
    pool: &State<PgPool>,
    node_id: String,
) -> Result<Value, Status> {
    let node: Option<Node> = sqlx::query_as(
        r#"
        SELECT node_id, role, current_zone, last_seen_ts, last_seq,
               battery_v, free_heap, status, is_simulated, sensor_ok,
               latest_co, latest_temp, latest_hum
        FROM mining_api_node WHERE node_id = $1
        "#,
    )
    .bind(&node_id)
    .fetch_optional(pool.inner())
    .await
    .unwrap_or(None);

    match node {
        Some(n) => Ok(json!(n)),
        None => Err(Status::NotFound),
    }
}

#[get("/api/v1/nodes/<node_id>/history?<limit>")]
pub async fn get_node_history(
    pool: &State<PgPool>,
    node_id: String,
    limit: Option<i64>,
) -> Result<Value, Status> {
    // Verify node exists
    let exists: Option<(String,)> = sqlx::query_as(
        r#"SELECT node_id FROM mining_api_node WHERE node_id = $1"#,
    )
    .bind(&node_id)
    .fetch_optional(pool.inner())
    .await
    .unwrap_or(None);

    if exists.is_none() {
        return Err(Status::NotFound);
    }

    let lim = limit.unwrap_or(50);
    let history: Vec<TelemetryRecord> = sqlx::query_as(
        r#"
        SELECT id, node_id, seq, zone, co_ppm, temp_c, humidity_pct,
               fall_detected, battery_v, is_simulated, sensor_ok,
               uptime_ms, received_at
        FROM mining_api_telemetryrecord
        WHERE node_id = $1
        ORDER BY received_at DESC
        LIMIT $2
        "#,
    )
    .bind(&node_id)
    .bind(lim)
    .fetch_all(pool.inner())
    .await
    .unwrap_or_default();

    let count = history.len();
    Ok(json!({
        "node_id": node_id,
        "history": history,
        "count": count
    }))
}
