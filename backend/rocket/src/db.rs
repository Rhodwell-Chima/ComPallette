use sqlx::{postgres::PgPoolOptions, PgPool};
use std::time::Duration;

pub async fn init_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await?;

    create_tables(&pool).await?;
    Ok(pool)
}

pub async fn create_tables(pool: &PgPool) -> Result<(), sqlx::Error> {
    // 1. Nodes table (matching Django model Node)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS mining_api_node (
            node_id VARCHAR(32) PRIMARY KEY,
            role VARCHAR(24) NOT NULL DEFAULT 'WEARABLE',
            current_zone VARCHAR(64) NOT NULL DEFAULT 'UNASSIGNED',
            last_seen_ts BIGINT NOT NULL DEFAULT 0,
            last_seq INTEGER NOT NULL DEFAULT 0,
            battery_v DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            free_heap INTEGER NOT NULL DEFAULT 0,
            status VARCHAR(16) NOT NULL DEFAULT 'ONLINE',
            is_simulated BOOLEAN NOT NULL DEFAULT TRUE,
            sensor_ok BOOLEAN NOT NULL DEFAULT TRUE,
            latest_co DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            latest_temp DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            latest_hum DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 2. Telemetry Records table (matching Django model TelemetryRecord)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS mining_api_telemetryrecord (
            id BIGSERIAL PRIMARY KEY,
            node_id VARCHAR(32) NOT NULL REFERENCES mining_api_node(node_id) ON DELETE CASCADE,
            seq INTEGER NOT NULL,
            zone VARCHAR(64) NOT NULL DEFAULT '',
            co_ppm DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            temp_c DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            humidity_pct DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            fall_detected BOOLEAN NOT NULL DEFAULT FALSE,
            battery_v DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            is_simulated BOOLEAN NOT NULL DEFAULT TRUE,
            sensor_ok BOOLEAN NOT NULL DEFAULT TRUE,
            uptime_ms BIGINT NOT NULL DEFAULT 0,
            received_at BIGINT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uq_telemetry_node_seq UNIQUE (node_id, seq)
        )
        "#,
    )
    .execute(pool)
    .await?;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_telemetry_received ON mining_api_telemetryrecord(node_id, received_at DESC)")
        .execute(pool)
        .await;

    // 3. Safety Alerts table (matching Django model SafetyAlert)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS mining_api_safetyalert (
            id BIGSERIAL PRIMARY KEY,
            node_id VARCHAR(32) NOT NULL REFERENCES mining_api_node(node_id) ON DELETE CASCADE,
            zone VARCHAR(64) NOT NULL DEFAULT '',
            severity VARCHAR(16) NOT NULL DEFAULT 'WARNING',
            alert_code VARCHAR(32) NOT NULL,
            details TEXT NOT NULL DEFAULT '',
            trigger_value DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            status VARCHAR(16) NOT NULL DEFAULT 'NEW',
            seq INTEGER NOT NULL DEFAULT 0,
            created_at BIGINT NOT NULL,
            acknowledged_at BIGINT,
            acknowledged_by VARCHAR(64) NOT NULL DEFAULT '',
            resolved_at BIGINT,
            resolved_by VARCHAR(64) NOT NULL DEFAULT '',
            resolution_notes TEXT NOT NULL DEFAULT '',
            CONSTRAINT uq_alert_node_seq_code UNIQUE (node_id, seq, alert_code)
        )
        "#,
    )
    .execute(pool)
    .await?;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_alert_status_sev ON mining_api_safetyalert(status, severity)")
        .execute(pool)
        .await;

    // 4. Audit Entries table (matching Django model AuditEntry)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS mining_api_auditentry (
            id BIGSERIAL PRIMARY KEY,
            timestamp BIGINT NOT NULL,
            actor VARCHAR(64) NOT NULL,
            action VARCHAR(32) NOT NULL,
            details TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(pool)
    .await?;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON mining_api_auditentry(timestamp DESC)")
        .execute(pool)
        .await;

    // 5. Provisioning Requests table (matching Django model ProvisioningRequest)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS mining_api_provisioningrequest (
            chip_id VARCHAR(16) PRIMARY KEY,
            chip_mac VARCHAR(24) NOT NULL DEFAULT '',
            mesh_node_id BIGINT NOT NULL DEFAULT 0,
            fw_version VARCHAR(16) NOT NULL DEFAULT '1.1.0',
            battery_v DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            mq_healthy BOOLEAN NOT NULL DEFAULT FALSE,
            mpu_healthy BOOLEAN NOT NULL DEFAULT FALSE,
            status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
            assigned_id VARCHAR(32) NOT NULL DEFAULT '',
            assigned_role VARCHAR(24) NOT NULL DEFAULT 'WEARABLE',
            assigned_zone VARCHAR(64) NOT NULL DEFAULT '',
            assigned_by VARCHAR(64) NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}
