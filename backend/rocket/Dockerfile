# Multi-stage Docker build for Compallette Rust Backend
FROM rust:slim AS builder

WORKDIR /app
COPY Cargo.toml ./
# Cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/compallette-backend-rocket /app/compallette-backend-rocket

ENV ROCKET_ADDRESS=0.0.0.0
ENV ROCKET_PORT=8000
EXPOSE 8000

CMD ["/app/compallette-backend-rocket"]
