use rocket::http::Status;
use rocket::request::{FromRequest, Outcome, Request};

pub struct ApiKey(pub String);

#[rocket::async_trait]
impl<'r> FromRequest<'r> for ApiKey {
    type Error = ();

    async fn from_request(req: &'r Request<'_>) -> Outcome<Self, Self::Error> {
        let expected_key = std::env::var("COMPALLETTE_API_KEY")
            .unwrap_or_else(|_| "compallette-mining-secret-key-v1".to_string());

        match req.headers().get_one("X-API-Key") {
            Some(key) if key == expected_key => Outcome::Success(ApiKey(key.to_string())),
            _ => Outcome::Error((Status::Unauthorized, ())),
        }
    }
}
