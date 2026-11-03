use rocket::serde::json::{json, Value};

#[get("/health")]
pub fn health() -> Value {
    json!({
        "status": "healthy",
        "service": "Compallette Mining Safety Rust/Rocket Backend",
        "version": "2.0.0",
        "engine": "Rocket 0.5.1 (Rust Async)",
        "database": "postgresql"
    })
}

#[get("/api/v1/health")]
pub fn api_health() -> Value {
    health()
}
