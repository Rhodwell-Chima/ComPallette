use crate::auth::ApiKey;
use crate::models::{AlertAckRequest, AlertResolveRequest, SafetyAlert};
use rocket::http::Status;
use rocket::serde::json::{json, Json, Value};
use rocket::State;
use sqlx::PgPool;
use std::time::{SystemTime, UNIX_EPOCH};

#[post("/api/v1/alert", data = "<data>")]
pub async fn ingest_alert(
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
    let seq = d.get("seq").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let role = d
        .get("role")
        .and_then(|v| v.as_str())
        .unwrap_or("WEARABLE")
        .to_string();
    let zone = d
        .get("zone")
        .and_then(|v| v.as_str())
        .unwrap_or("UNASSIGNED")
        .to_string();

    let payload = d.get("payload").cloned().unwrap_or(Value::Null);
    let severity = payload
        .get("severity")
        .or_else(|| d.get("severity"))
        .and_then(|v| v.as_str())
        .unwrap_or("WARNING")
        .to_string();
    let alert_code = payload
        .get("code")
        .or_else(|| payload.get("alert_code"))
        .or_else(|| d.get("alert_type"))
        .or_else(|| d.get("code"))
        .and_then(|v| v.as_str())
        .unwrap_or("UNKNOWN")
        .to_string();
    let details = payload
        .get("details")
        .or_else(|| d.get("message"))
        .or_else(|| d.get("details"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let trigger_value = payload
        .get("val")
        .or_else(|| payload.get("trigger_value"))
        .or_else(|| d.get("val"))
        .or_else(|| d.get("trigger_value"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    // 1. Upsert Node
    let _ = sqlx::query(
        r#"
        INSERT INTO mining_api_node (
            node_id, role, current_zone, last_seen_ts, last_seq,
            battery_v, free_heap, status, is_simulated, sensor_ok,
            latest_co, latest_temp, latest_hum, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, 0, 0.0, 0, 'ONLINE', FALSE, TRUE, 0.0, 0.0, 0.0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (node_id) DO UPDATE SET
            role = EXCLUDED.role,
            current_zone = EXCLUDED.current_zone,
            last_seen_ts = EXCLUDED.last_seen_ts,
            status = 'ONLINE',
            updated_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(&node_id)
    .bind(&role)
    .bind(&zone)
    .bind(now_ms)
    .execute(pool.inner())
    .await;

    // 2. Check deduplication on (node_id, seq, alert_code)
    let existing: Option<(i64,)> = sqlx::query_as(
        r#"
        SELECT id FROM mining_api_safetyalert
        WHERE node_id = $1 AND seq = $2 AND alert_code = $3
        "#,
    )
    .bind(&node_id)
    .bind(seq)
    .bind(&alert_code)
    .fetch_optional(pool.inner())
    .await
    .unwrap_or(None);

    if let Some((existing_id,)) = existing {
        return json!({
            "status": "ok",
            "recorded": false,
            "deduplicated": true,
            "alert_id": existing_id,
            "node_id": node_id
        });
    }

    // 3. Insert Alert
    let alert_id: i64 = match sqlx::query_scalar(
        r#"
        INSERT INTO mining_api_safetyalert (
            node_id, zone, severity, alert_code, details,
            trigger_value, status, seq, created_at,
            acknowledged_by, resolved_by, resolution_notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'NEW', $7, $8, '', '', '')
        RETURNING id
        "#,
    )
    .bind(&node_id)
    .bind(&zone)
    .bind(&severity)
    .bind(&alert_code)
    .bind(&details)
    .bind(trigger_value)
    .bind(seq)
    .bind(now_ms)
    .fetch_one(pool.inner())
    .await {
        Ok(id) => id,
        Err(e) => {
            eprintln!("[ROCKET ERROR] Insert alert failed: {}", e);
            0
        }
    };

    // 4. Log Audit Entry
    let audit_details = format!(
        "Severity: {} | Code: {} | Zone: {} | Val: {}",
        severity, alert_code, zone, trigger_value
    );
    let _ = sqlx::query(
        r#"
        INSERT INTO mining_api_auditentry (timestamp, actor, action, details, created_at)
        VALUES ($1, $2, 'ALERT_TRIGGERED', $3, CURRENT_TIMESTAMP)
        "#,
    )
    .bind(now_ms)
    .bind(&node_id)
    .bind(&audit_details)
    .execute(pool.inner())
    .await;

    json!({
        "status": "ok",
        "recorded": true,
        "deduplicated": false,
        "alert_id": alert_id,
        "node_id": node_id
    })
}

#[get("/api/v1/alerts?<status>&<severity>&<limit>")]
pub async fn list_alerts(
    pool: &State<PgPool>,
    status: Option<String>,
    severity: Option<String>,
    limit: Option<i64>,
) -> Value {
    let lim = limit.unwrap_or(100);

    let alerts: Vec<SafetyAlert> = match (status, severity) {
        (Some(st), Some(sev)) => sqlx::query_as(
            r#"
            SELECT * FROM mining_api_safetyalert
            WHERE status = $1 AND severity = $2
            ORDER BY created_at DESC LIMIT $3
            "#,
        )
        .bind(st)
        .bind(sev)
        .bind(lim)
        .fetch_all(pool.inner())
        .await
        .unwrap_or_default(),

        (Some(st), None) => sqlx::query_as(
            r#"
            SELECT * FROM mining_api_safetyalert
            WHERE status = $1
            ORDER BY created_at DESC LIMIT $2
            "#,
        )
        .bind(st)
        .bind(lim)
        .fetch_all(pool.inner())
        .await
        .unwrap_or_default(),

        (None, Some(sev)) => sqlx::query_as(
            r#"
            SELECT * FROM mining_api_safetyalert
            WHERE severity = $1
            ORDER BY created_at DESC LIMIT $2
            "#,
        )
        .bind(sev)
        .bind(lim)
        .fetch_all(pool.inner())
        .await
        .unwrap_or_default(),

        (None, None) => sqlx::query_as(
            r#"
            SELECT * FROM mining_api_safetyalert
            ORDER BY created_at DESC LIMIT $1
            "#,
        )
        .bind(lim)
        .fetch_all(pool.inner())
        .await
        .unwrap_or_default(),
    };

    let count = alerts.len();
    json!({
        "alerts": alerts,
        "count": count
    })
}

#[get("/api/v1/alerts/<alert_id>")]
pub async fn get_alert(
    pool: &State<PgPool>,
    alert_id: i64,
) -> Result<Value, Status> {
    let alert: Option<SafetyAlert> = sqlx::query_as(
        r#"SELECT * FROM mining_api_safetyalert WHERE id = $1"#
    )
    .bind(alert_id)
    .fetch_optional(pool.inner())
    .await
    .unwrap_or(None);

    match alert {
        Some(a) => Ok(json!(a)),
        None => Err(Status::NotFound),
    }
}

#[post("/api/v1/alerts/<alert_id>/ack", data = "<data>")]
pub async fn ack_alert(
    pool: &State<PgPool>,
    alert_id: i64,
    data: Option<Json<AlertAckRequest>>,
) -> Result<Value, Status> {
    ack_alert_impl(pool, alert_id, data).await
}

#[post("/api/v1/alerts/<alert_id>/acknowledge", data = "<data>")]
pub async fn acknowledge_alert(
    pool: &State<PgPool>,
    alert_id: i64,
    data: Option<Json<AlertAckRequest>>,
) -> Result<Value, Status> {
    ack_alert_impl(pool, alert_id, data).await
}

async fn ack_alert_impl(
    pool: &State<PgPool>,
    alert_id: i64,
    data: Option<Json<AlertAckRequest>>,
) -> Result<Value, Status> {
    let alert: Option<SafetyAlert> = sqlx::query_as(
        r#"SELECT * FROM mining_api_safetyalert WHERE id = $1"#
    )
    .bind(alert_id)
    .fetch_optional(pool.inner())
    .await
    .unwrap_or(None);

    match alert {
        Some(a) if a.status == "NEW" => (),
        _ => return Err(Status::NotFound),
    };

    let officer = data
        .and_then(|d| d.officer_name.clone().or(d.officer.clone()))
        .unwrap_or_else(|| "Safety_Officer".to_string());

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let _ = sqlx::query(
        r#"
        UPDATE mining_api_safetyalert
        SET status = 'ACKNOWLEDGED', acknowledged_at = $1, acknowledged_by = $2
        WHERE id = $3
        "#
    )
    .bind(now_ms)
    .bind(&officer)
    .bind(alert_id)
    .execute(pool.inner())
    .await;

    let audit_details = format!("Alert #{} acknowledged by {}", alert_id, officer);
    let _ = sqlx::query(
        r#"
        INSERT INTO mining_api_auditentry (timestamp, actor, action, details, created_at)
        VALUES ($1, $2, 'ALERT_ACKNOWLEDGED', $3, CURRENT_TIMESTAMP)
        "#
    )
    .bind(now_ms)
    .bind(&officer)
    .bind(&audit_details)
    .execute(pool.inner())
    .await;

    Ok(json!({
        "status": "ok",
        "message": format!("Alert #{} acknowledged", alert_id),
        "alert_id": alert_id
    }))
}

#[post("/api/v1/alerts/<alert_id>/resolve", data = "<data>")]
pub async fn resolve_alert(
    pool: &State<PgPool>,
    alert_id: i64,
    data: Option<Json<AlertResolveRequest>>,
) -> Result<Value, Status> {
    resolve_alert_impl(pool, alert_id, data).await
}

async fn resolve_alert_impl(
    pool: &State<PgPool>,
    alert_id: i64,
    data: Option<Json<AlertResolveRequest>>,
) -> Result<Value, Status> {
    let alert: Option<SafetyAlert> = sqlx::query_as(
        r#"SELECT * FROM mining_api_safetyalert WHERE id = $1"#
    )
    .bind(alert_id)
    .fetch_optional(pool.inner())
    .await
    .unwrap_or(None);

    match alert {
        Some(a) if a.status != "RESOLVED" => (),
        _ => return Err(Status::NotFound),
    };

    let (officer, notes) = if let Some(d) = data {
        (
            d.officer_name.clone().or(d.officer.clone()).unwrap_or_else(|| "Safety_Officer".to_string()),
            d.notes.clone().unwrap_or_else(|| "Hazard cleared.".to_string()),
        )
    } else {
        ("Safety_Officer".to_string(), "Hazard cleared.".to_string())
    };

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let _ = sqlx::query(
        r#"
        UPDATE mining_api_safetyalert
        SET status = 'RESOLVED', resolved_at = $1, resolved_by = $2, resolution_notes = $3
        WHERE id = $4
        "#
    )
    .bind(now_ms)
    .bind(&officer)
    .bind(&notes)
    .bind(alert_id)
    .execute(pool.inner())
    .await;

    let audit_details = format!("Alert #{} resolved: {}", alert_id, notes);
    let _ = sqlx::query(
        r#"
        INSERT INTO mining_api_auditentry (timestamp, actor, action, details, created_at)
        VALUES ($1, $2, 'ALERT_RESOLVED', $3, CURRENT_TIMESTAMP)
        "#
    )
    .bind(now_ms)
    .bind(&officer)
    .bind(&audit_details)
    .execute(pool.inner())
    .await;

    Ok(json!({
        "status": "ok",
        "message": format!("Alert #{} resolved", alert_id),
        "alert_id": alert_id
    }))
}
