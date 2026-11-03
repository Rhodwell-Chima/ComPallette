use crate::models::AuditEntry;
use rocket::serde::json::{json, Value};
use rocket::State;
use sqlx::PgPool;

#[get("/api/v1/audit?<limit>")]
pub async fn list_audit(pool: &State<PgPool>, limit: Option<i64>) -> Value {
    let lim = limit.unwrap_or(100);

    let entries: Vec<AuditEntry> = sqlx::query_as(
        r#"
        SELECT id, timestamp, actor, action, details
        FROM mining_api_auditentry
        ORDER BY timestamp DESC
        LIMIT $1
        "#,
    )
    .bind(lim)
    .fetch_all(pool.inner())
    .await
    .unwrap_or_default();

    let count = entries.len();
    json!({
        "audit_log": entries,
        "count": count
    })
}
