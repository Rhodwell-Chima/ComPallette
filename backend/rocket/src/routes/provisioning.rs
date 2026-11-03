use crate::auth::ApiKey;
use crate::models::{ProvisioningAssignRequest, ProvisioningConfirmRequest, ProvisioningRequest};
use rocket::http::Status;
use rocket::serde::json::{json, Json, Value};
use rocket::State;
use sqlx::PgPool;
use std::time::{SystemTime, UNIX_EPOCH};

#[post("/api/v1/provision/request", data = "<data>")]
pub async fn ingest_provision_request(
    _api_key: ApiKey,
    pool: &State<PgPool>,
    data: Json<Value>,
) -> Result<Value, Status> {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let d = data.into_inner();
    let payload = d.get("payload").cloned().unwrap_or(Value::Null);

    let chip_id = payload
        .get("chip_id")
        .and_then(|v| v.as_str())
        .or_else(|| {
            d.get("sender")
                .and_then(|v| v.as_str())
                .map(|s| s.trim_start_matches("PROV-"))
        })
        .unwrap_or("")
        .to_string();

    if chip_id.is_empty() {
        return Err(Status::BadRequest);
    }

    let chip_mac = payload
        .get("chip_mac")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mesh_node_id = payload
        .get("mesh_id")
        .or_else(|| payload.get("mesh_node_id"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let fw_version = payload
        .get("fw_ver")
        .or_else(|| payload.get("fw_version"))
        .and_then(|v| v.as_str())
        .unwrap_or("1.1.0")
        .to_string();
    let battery_v = payload
        .get("batt")
        .or_else(|| payload.get("battery_v"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let mq_healthy = payload
        .get("mq_ok")
        .or_else(|| payload.get("mq_healthy"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let mpu_healthy = payload
        .get("mpu_ok")
        .or_else(|| payload.get("mpu_healthy"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let existing: Option<(String,)> = sqlx::query_as(
        r#"SELECT chip_id FROM mining_api_provisioningrequest WHERE chip_id = $1"#,
    )
    .bind(&chip_id)
    .fetch_optional(pool.inner())
    .await
    .unwrap_or(None);

    let created = existing.is_none();

    let _ = sqlx::query(
        r#"
        INSERT INTO mining_api_provisioningrequest (
            chip_id, chip_mac, mesh_node_id, fw_version,
            battery_v, mq_healthy, mpu_healthy, status,
            assigned_id, assigned_role, assigned_zone, assigned_by,
            created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', '', 'WEARABLE', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (chip_id) DO UPDATE SET
            chip_mac = EXCLUDED.chip_mac,
            mesh_node_id = EXCLUDED.mesh_node_id,
            fw_version = EXCLUDED.fw_version,
            battery_v = EXCLUDED.battery_v,
            mq_healthy = EXCLUDED.mq_healthy,
            mpu_healthy = EXCLUDED.mpu_healthy,
            status = 'PENDING',
            updated_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(&chip_id)
    .bind(&chip_mac)
    .bind(mesh_node_id)
    .bind(&fw_version)
    .bind(battery_v)
    .bind(mq_healthy)
    .bind(mpu_healthy)
    .execute(pool.inner())
    .await;

    let audit_details = format!("Unassigned node beacon detected: Chip #{} (MAC: {})", chip_id, chip_mac);
    let _ = sqlx::query(
        r#"
        INSERT INTO mining_api_auditentry (timestamp, actor, action, details, created_at)
        VALUES ($1, 'GATEWAY', 'NODE_DISCOVERED', $2, CURRENT_TIMESTAMP)
        "#,
    )
    .bind(now_ms)
    .bind(&audit_details)
    .execute(pool.inner())
    .await;

    Ok(json!({
        "status": "recorded",
        "chip_id": chip_id,
        "created": created
    }))
}

#[get("/api/v1/provision/pending")]
pub async fn list_pending_provision(pool: &State<PgPool>) -> Value {
    let pending: Vec<ProvisioningRequest> = sqlx::query_as(
        r#"
        SELECT chip_id, chip_mac, mesh_node_id, fw_version, battery_v,
               mq_healthy, mpu_healthy, status, assigned_id, assigned_role,
               assigned_zone, assigned_by
        FROM mining_api_provisioningrequest
        WHERE status = 'PENDING'
        ORDER BY updated_at DESC
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .unwrap_or_default();

    let count = pending.len();
    json!({
        "pending_nodes": pending,
        "count": count
    })
}

#[post("/api/v1/provision/assign", data = "<data>")]
pub async fn assign_provision(
    pool: &State<PgPool>,
    data: Json<ProvisioningAssignRequest>,
) -> Result<Value, Status> {
    let req = data.into_inner();
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let existing: Option<(String,)> = sqlx::query_as(
        r#"SELECT chip_id FROM mining_api_provisioningrequest WHERE chip_id = $1"#,
    )
    .bind(&req.chip_id)
    .fetch_optional(pool.inner())
    .await
    .unwrap_or(None);

    if existing.is_none() {
        return Err(Status::NotFound);
    }

    // 1. Update ProvisioningRequest
    let _ = sqlx::query(
        r#"
        UPDATE mining_api_provisioningrequest
        SET status = 'ASSIGNED', assigned_id = $1, assigned_role = $2,
            assigned_zone = $3, assigned_by = $4, updated_at = CURRENT_TIMESTAMP
        WHERE chip_id = $5
        "#,
    )
    .bind(&req.device_id)
    .bind(&req.role)
    .bind(&req.zone_id)
    .bind(&req.officer_name)
    .bind(&req.chip_id)
    .execute(pool.inner())
    .await;

    // 2. Pre-seed or update Node in mining_api_node
    let _ = sqlx::query(
        r#"
        INSERT INTO mining_api_node (
            node_id, role, current_zone, status, last_seen_ts,
            last_seq, battery_v, free_heap, is_simulated, sensor_ok,
            latest_co, latest_temp, latest_hum, created_at, updated_at
        )
        VALUES ($1, $2, $3, 'ONLINE', $4, 0, 0.0, 0, FALSE, TRUE, 0.0, 0.0, 0.0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (node_id) DO UPDATE SET
            role = EXCLUDED.role,
            current_zone = EXCLUDED.current_zone,
            status = 'ONLINE',
            last_seen_ts = EXCLUDED.last_seen_ts,
            updated_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(&req.device_id)
    .bind(&req.role)
    .bind(&req.zone_id)
    .bind(now_ms)
    .execute(pool.inner())
    .await;

    // 3. Log Audit
    let audit_details = format!(
        "Chip #{} assigned identity '{}' ({}) @ {}",
        req.chip_id, req.device_id, req.role, req.zone_id
    );
    let _ = sqlx::query(
        r#"
        INSERT INTO mining_api_auditentry (timestamp, actor, action, details, created_at)
        VALUES ($1, $2, 'NODE_ASSIGNED', $3, CURRENT_TIMESTAMP)
        "#,
    )
    .bind(now_ms)
    .bind(&req.officer_name)
    .bind(&audit_details)
    .execute(pool.inner())
    .await;

    // 4. Build exact downlink mesh frame
    let downlink_frame = json!({
        "ver": 1,
        "type": "PROV_ASSIGN",
        "seq": 1,
        "sender": "GW-SURFACE-01",
        "role": "GATEWAY",
        "zone": "SURFACE-PORTAL",
        "uptime": 0,
        "payload": {
            "target_chip": req.chip_id,
            "assigned_id": req.device_id,
            "role": req.role,
            "zone": req.zone_id,
            "co_warn": 25.0,
            "co_crit": 50.0,
            "reboot": true
        }
    });

    Ok(json!({
        "status": "assigned",
        "chip_id": req.chip_id,
        "assigned_id": req.device_id,
        "downlink_frame": downlink_frame
    }))
}

#[post("/api/v1/provision/confirm", data = "<data>")]
pub async fn confirm_provision(
    pool: &State<PgPool>,
    data: Json<ProvisioningConfirmRequest>,
) -> Result<Value, Status> {
    let req = data.into_inner();
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let prov: Option<ProvisioningRequest> = sqlx::query_as(
        r#"
        SELECT chip_id, chip_mac, mesh_node_id, fw_version, battery_v,
               mq_healthy, mpu_healthy, status, assigned_id, assigned_role,
               assigned_zone, assigned_by
        FROM mining_api_provisioningrequest WHERE chip_id = $1
        "#,
    )
    .bind(&req.chip_id)
    .fetch_optional(pool.inner())
    .await
    .unwrap_or(None);

    let p = match prov {
        Some(p) => p,
        None => return Err(Status::NotFound),
    };

    let _ = sqlx::query(
        r#"
        UPDATE mining_api_provisioningrequest
        SET status = 'CONFIRMED', updated_at = CURRENT_TIMESTAMP
        WHERE chip_id = $1
        "#,
    )
    .bind(&req.chip_id)
    .execute(pool.inner())
    .await;

    let audit_details = format!(
        "Chip #{} confirmed active as '{}' ({})",
        req.chip_id, p.assigned_id, p.assigned_role
    );
    let _ = sqlx::query(
        r#"
        INSERT INTO mining_api_auditentry (timestamp, actor, action, details, created_at)
        VALUES ($1, 'GATEWAY', 'NODE_COMMISSIONED', $2, CURRENT_TIMESTAMP)
        "#,
    )
    .bind(now_ms)
    .bind(&audit_details)
    .execute(pool.inner())
    .await;

    Ok(json!({
        "status": "confirmed",
        "chip_id": req.chip_id,
        "device_id": p.assigned_id
    }))
}
