use crate::models::{Node, TelemetryRecord};
use crate::watchdog::run_watchdog;
use rocket::http::Status;
use rocket::serde::json::{json, Value};
use rocket::State;
use sqlx::PgPool;

#[get("/api/v1/nodes?<status>&<active>")]
pub async fn list_nodes(
    pool: &State<PgPool>,
    status: Option<String>,
    active: Option<String>,
) -> Value {
    let _ = run_watchdog(pool.inner()).await;

    let filter_type = if let Some(s) = status {
        let su = s.to_uppercase();
        if su == "ACTIVE" || su == "ONLINE" {
            Some("ACTIVE")
        } else if su == "INACTIVE" || su == "OFFLINE" {
            Some("INACTIVE")
        } else if su == "STALE" {
            Some("STALE")
        } else {
            None
        }
    } else if let Some(a) = active {
        let al = a.to_lowercase();
        if al == "true" || al == "1" || al == "active" {
            Some("ACTIVE")
        } else if al == "false" || al == "0" || al == "inactive" {
            Some("INACTIVE")
        } else {
            None
        }
    } else {
        None
    };

    let nodes: Vec<Node> = match filter_type {
        Some("ACTIVE") => sqlx::query_as(
            r#"
            SELECT node_id, role, current_zone, last_seen_ts, last_seq,
                   battery_v, free_heap, status, is_simulated, sensor_ok,
                   latest_co, latest_temp, latest_hum
            FROM mining_api_node
            WHERE status = 'ONLINE'
            ORDER BY node_id ASC
            "#,
        )
        .fetch_all(pool.inner())
        .await
        .unwrap_or_default(),

        Some("INACTIVE") => sqlx::query_as(
            r#"
            SELECT node_id, role, current_zone, last_seen_ts, last_seq,
                   battery_v, free_heap, status, is_simulated, sensor_ok,
                   latest_co, latest_temp, latest_hum
            FROM mining_api_node
            WHERE status IN ('OFFLINE', 'STALE')
            ORDER BY node_id ASC
            "#,
        )
        .fetch_all(pool.inner())
        .await
        .unwrap_or_default(),

        Some("STALE") => sqlx::query_as(
            r#"
            SELECT node_id, role, current_zone, last_seen_ts, last_seq,
                   battery_v, free_heap, status, is_simulated, sensor_ok,
                   latest_co, latest_temp, latest_hum
            FROM mining_api_node
            WHERE status = 'STALE'
            ORDER BY node_id ASC
            "#,
        )
        .fetch_all(pool.inner())
        .await
        .unwrap_or_default(),

        _ => sqlx::query_as(
            r#"
            SELECT node_id, role, current_zone, last_seen_ts, last_seq,
                   battery_v, free_heap, status, is_simulated, sensor_ok,
                   latest_co, latest_temp, latest_hum
            FROM mining_api_node
            ORDER BY node_id ASC
            "#,
        )
        .fetch_all(pool.inner())
        .await
        .unwrap_or_default(),
    };

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
