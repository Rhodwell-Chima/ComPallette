# Compallette Backend: Rust + Rocket

High-performance, async telemetry ingestion service designed for stress-testing and benchmarking against the Python/Django backend.

## Purpose
1. **Zero-Garbage Collection**: Eliminate memory latency spikes under mining emergency packet bursts.
2. **Sub-millisecond Latency**: Process raw mesh telemetry packets in $< 2\,\text{ms}$.
3. **Resource Efficiency**: Run on low-power surface edge industrial PCs (Raspberry Pi, DIN-rail edge boxes).

## Running via Docker
To run this Rocket service instead of Django:
```bash
docker compose --profile rocket up backend-rocket frontend db
```

## Running Natively (Requires Rust Toolchain)
```bash
cargo run --release
```
