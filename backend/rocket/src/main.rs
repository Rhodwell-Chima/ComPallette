#[macro_use]
extern crate rocket;

mod auth;
mod cors;
mod db;
mod models;
mod routes;
mod watchdog;

use sqlx::PgPool;
use std::time::Duration;

#[launch]
async fn rocket() -> _ {
    dotenvy::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
        "postgres://compallette_user:compallette_secure_pass_2026@127.0.0.1:5432/compallette_db"
            .to_string()
    });

    println!(
        "[ROCKET] Initializing PostgreSQL connection pool: {}",
        database_url
    );

    let pool: PgPool = match db::init_pool(&database_url).await {
        Ok(p) => {
            println!("[ROCKET] PostgreSQL connected & schema bootstrapped successfully.");
            p
        }
        Err(e) => {
            eprintln!("[ROCKET ERROR] Could not connect to PostgreSQL on startup: {}", e);
            eprintln!("[ROCKET WARN] Proceeding with retrying pool or standalone mode...");
            // Create lazy pool so server still boots up even if database is starting in parallel
            sqlx::postgres::PgPoolOptions::new()
                .max_connections(20)
                .connect_lazy(&database_url)
                .expect("Failed to create lazy pool")
        }
    };

    // Spawn background watchdog loop (runs every 10 seconds)
    let watchdog_pool = pool.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        loop {
            interval.tick().await;
            if let Err(e) = watchdog::run_watchdog(&watchdog_pool).await {
                // Silently skip if DB not yet available
                let _ = e;
            }
        }
    });

    rocket::build()
        .manage(pool)
        .attach(cors::Cors)
        .mount(
            "/",
            routes![
                cors::cors_preflight,
                routes::health::health,
                routes::health::api_health,
                routes::telemetry::ingest_telemetry,
                routes::alert::ingest_alert,
                routes::alert::list_alerts,
                routes::alert::get_alert,
                routes::alert::ack_alert,
                routes::alert::acknowledge_alert,
                routes::alert::resolve_alert,
                routes::heartbeat::ingest_heartbeat,
                routes::summary::system_summary,
                routes::nodes::list_nodes,
                routes::nodes::get_node,
                routes::nodes::get_node_history,
                routes::audit::list_audit,
                routes::provisioning::ingest_provision_request,
                routes::provisioning::list_pending_provision,
                routes::provisioning::assign_provision,
                routes::provisioning::confirm_provision,
            ],
        )
}
