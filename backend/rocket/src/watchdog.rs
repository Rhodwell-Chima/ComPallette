use sqlx::PgPool;
use std::time::{SystemTime, UNIX_EPOCH};

pub async fn run_watchdog(pool: &PgPool) -> Result<(), sqlx::Error> {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let stale_sec: i64 = std::env::var("COMPALLETTE_STALE_SEC")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(20);
    let offline_sec: i64 = std::env::var("COMPALLETTE_OFFLINE_SEC")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(45);

    let stale_limit = now_ms - (stale_sec * 1000);
    let offline_limit = now_ms - (offline_sec * 1000);

    // 1. Mark STALE nodes
    sqlx::query(
        r#"
        UPDATE mining_api_node
        SET status = 'STALE', updated_at = CURRENT_TIMESTAMP
        WHERE last_seen_ts < $1 AND last_seen_ts >= $2 AND status = 'ONLINE'
        "#,
    )
    .bind(stale_limit)
    .bind(offline_limit)
    .execute(pool)
    .await?;

    // 2. Query nodes dropping to OFFLINE
    let dropping_nodes: Vec<(String, String, String)> = sqlx::query_as(
        r#"
        SELECT node_id, role, current_zone
        FROM mining_api_node
        WHERE last_seen_ts < $1 AND status != 'OFFLINE'
        "#,
    )
    .bind(offline_limit)
    .fetch_all(pool)
    .await?;

    for (node_id, role, zone) in dropping_nodes {
        // Update to OFFLINE
        sqlx::query(
            r#"
            UPDATE mining_api_node
            SET status = 'OFFLINE', updated_at = CURRENT_TIMESTAMP
            WHERE node_id = $1
            "#,
        )
        .bind(&node_id)
        .execute(pool)
        .await?;

        // Generate automated COMM_LOST safety alert
        let details = format!(
            "Node {} ({}) lost underground communication in {}",
            node_id, role, zone
        );

        let _ = sqlx::query(
            r#"
            INSERT INTO mining_api_safetyalert (
                node_id, zone, severity, alert_code, details, trigger_value, status, seq, created_at,
                acknowledged_by, resolved_by, resolution_notes
            )
            VALUES ($1, $2, 'WARNING', 'COMM_LOST', $3, 0.0, 'NEW', 0, $4, '', '', '')
            ON CONFLICT (node_id, seq, alert_code) DO NOTHING
            "#,
        )
        .bind(&node_id)
        .bind(&zone)
        .bind(&details)
        .bind(now_ms)
        .execute(pool)
        .await;

        // Log audit entry
        let audit_details = format!("Node {} marked OFFLINE in {}", node_id, zone);
        let _ = sqlx::query(
            r#"
            INSERT INTO mining_api_auditentry (timestamp, actor, action, details, created_at)
            VALUES ($1, 'SYSTEM_WATCHDOG', 'COMM_LOST', $2, CURRENT_TIMESTAMP)
            "#,
        )
        .bind(now_ms)
        .bind(&audit_details)
        .execute(pool)
        .await;
    }

    Ok(())
}
