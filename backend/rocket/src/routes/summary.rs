use crate::watchdog::run_watchdog;
use rocket::serde::json::{json, Value};
use rocket::State;
use sqlx::PgPool;

#[get("/api/v1/system/summary")]
pub async fn system_summary(pool: &State<PgPool>) -> Value {
    // 1. Run watchdog pass
    let _ = run_watchdog(pool.inner()).await;

    // 2. Aggregate metrics from PostgreSQL
    let total_nodes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mining_api_node")
        .fetch_one(pool.inner())
        .await
        .unwrap_or(0);

    let online_miners: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mining_api_node WHERE role = 'WEARABLE' AND status = 'ONLINE'",
    )
    .fetch_one(pool.inner())
    .await
    .unwrap_or(0);

    let stale_nodes: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mining_api_node WHERE status = 'STALE'",
    )
    .fetch_one(pool.inner())
    .await
    .unwrap_or(0);

    let offline_nodes: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mining_api_node WHERE status = 'OFFLINE'",
    )
    .fetch_one(pool.inner())
    .await
    .unwrap_or(0);

    let new_alerts: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mining_api_safetyalert WHERE status = 'NEW'",
    )
    .fetch_one(pool.inner())
    .await
    .unwrap_or(0);

    let crit_emergencies: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mining_api_safetyalert WHERE status = 'NEW' AND severity = 'CRITICAL'",
    )
    .fetch_one(pool.inner())
    .await
    .unwrap_or(0);

    let ack_in_progress: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mining_api_safetyalert WHERE status = 'ACKNOWLEDGED'",
    )
    .fetch_one(pool.inner())
    .await
    .unwrap_or(0);

    let co_warn: f64 = std::env::var("CO_WARN_PPM")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(25.0);
    let co_crit: f64 = std::env::var("CO_CRIT_PPM")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(50.0);

    let gas_warn: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mining_api_node WHERE latest_co >= $1 AND latest_co < $2",
    )
    .bind(co_warn)
    .bind(co_crit)
    .fetch_one(pool.inner())
    .await
    .unwrap_or(0);

    let gas_crit: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mining_api_node WHERE latest_co >= $1",
    )
    .bind(co_crit)
    .fetch_one(pool.inner())
    .await
    .unwrap_or(0);

    let last_rx: i64 = sqlx::query_scalar(
        "SELECT received_at FROM mining_api_telemetryrecord ORDER BY received_at DESC LIMIT 1",
    )
    .fetch_optional(pool.inner())
    .await
    .unwrap_or(None)
    .unwrap_or(0);

    json!({
        "total_nodes_tracked": total_nodes,
        "online_miners": online_miners,
        "stale_nodes": stale_nodes,
        "offline_nodes": offline_nodes,
        "active_unacknowledged_alerts": new_alerts,
        "critical_emergencies": crit_emergencies,
        "acknowledged_in_progress": ack_in_progress,
        "miners_in_gas_warning": gas_warn,
        "miners_in_gas_critical": gas_crit,
        "last_packet_received_ms": last_rx
    })
}
