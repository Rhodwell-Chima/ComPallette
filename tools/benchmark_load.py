#!/usr/bin/env python3
"""
COMPALLETTE BACKEND BENCHMARKING HARNESS
========================================
Stress tests and benchmarks the telemetry ingestion throughput of any backend
(Django, Rust Rocket, etc.) to evaluate:
- Packets/sec throughput
- Average & p95/p99 latency
- Error rates & dropped packets
- Concurrency behavior under simulated emergency storms

Usage:
    python tools/benchmark_load.py --url http://127.0.0.1:8000 --requests 1000 --concurrency 10
"""

import argparse
import concurrent.futures
import json
import random
import time
import urllib.request
import urllib.error

API_KEY = "compallette-mining-secret-key-v1"


def send_packet(url, miner_idx, seq):
    payload = {
        "ver": 1,
        "type": "TELEMETRY",
        "seq": seq,
        "sender": f"MINER-BENCH-{miner_idx:03d}",
        "role": "WEARABLE",
        "zone": "LEVEL-250-SOUTH",
        "uptime": seq * 1000,
        "payload": {
            "co": round(random.uniform(5.0, 30.0), 1),
            "temp": round(random.uniform(22.0, 32.0), 1),
            "hum": 70.0,
            "fall": False,
            "batt": 4.10,
            "sim": True,
            "ok": True
        }
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url.rstrip("/") + "/api/v1/telemetry",
        data=data,
        headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
        method="POST"
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            latency_ms = (time.perf_counter() - t0) * 1000.0
            return resp.status == 200, latency_ms
    except Exception as e:
        latency_ms = (time.perf_counter() - t0) * 1000.0
        return False, latency_ms


def main():
    parser = argparse.ArgumentParser(description="Compallette Ingestion Benchmark")
    parser.add_argument("--url", default="http://127.0.0.1:8000", help="Backend base URL")
    parser.add_argument("--requests", type=int, default=500, help="Total number of packets to send")
    parser.add_argument("--concurrency", type=int, default=10, help="Number of concurrent client workers")
    args = parser.parse_args()

    print("=" * 60)
    print("COMPALLETTE INGESTION PERFORMANCE BENCHMARK")
    print(f"Target URL:    {args.url}")
    print(f"Total Packets: {args.requests}")
    print(f"Concurrency:   {args.concurrency} threads")
    print("=" * 60)

    start_total = time.perf_counter()
    latencies = []
    successes = 0
    failures = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = [
            executor.submit(send_packet, args.url, i % 20, i + 1)
            for i in range(args.requests)
        ]
        for f in concurrent.futures.as_completed(futures):
            ok, lat = f.result()
            latencies.append(lat)
            if ok:
                successes += 1
            else:
                failures += 1

    total_time = time.perf_counter() - start_total
    latencies.sort()
    avg_lat = sum(latencies) / len(latencies) if latencies else 0
    p50 = latencies[int(len(latencies) * 0.50)] if latencies else 0
    p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0
    p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0
    rps = args.requests / total_time if total_time > 0 else 0

    print("\nBENCHMARK RESULTS:")
    print("-" * 60)
    print(f"Total Duration:     {total_time:.3f} s")
    print(f"Throughput:         {rps:.1f} packets/second")
    print(f"Success Rate:       {successes}/{args.requests} ({successes / args.requests * 100:.1f}%)")
    print(f"Failed Packets:     {failures}")
    print(f"Average Latency:    {avg_lat:.2f} ms")
    print(f"Median (p50):       {p50:.2f} ms")
    print(f"95th Percentile:    {p95:.2f} ms")
    print(f"99th Percentile:    {p99:.2f} ms")
    print("=" * 60)


if __name__ == "__main__":
    main()
