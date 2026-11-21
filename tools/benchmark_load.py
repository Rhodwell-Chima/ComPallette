#!/usr/bin/env python3
"""
COMPALLETTE BACKEND BENCHMARKING HARNESS
========================================
Stress tests and benchmarks the telemetry ingestion throughput of an isolated
Django installation with commissioned test devices to evaluate:
- Packets/sec throughput
- Average & p95/p99 latency
- Error rates & dropped packets
- Concurrency behavior under simulated emergency storms

Usage:
    python tools/benchmark_load.py --help

The gateway/site/installation and protected credential file are mandatory.
Quarantine responses and duplicate events do not count as newly persisted telemetry.
"""

import argparse
import concurrent.futures
import json
import random
import time
import urllib.request
import urllib.error

from pathlib import Path

API_KEY = ""
GATEWAY_ID = ""
INSTALLATION_ID = ""
SENDER_PREFIX = "BENCH"


def send_packet(url, miner_idx, seq):
    payload = {
        "installation_id": INSTALLATION_ID,
        "ver": 1,
        "type": "TELEMETRY",
        "seq": seq,
        "sender": f"{SENDER_PREFIX}-{miner_idx:03d}",
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
        headers={"Content-Type": "application/json", "X-API-Key": API_KEY, "X-Gateway-ID": GATEWAY_ID},
        method="POST"
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            latency_ms = (time.perf_counter() - t0) * 1000.0
            receipt = json.loads(resp.read())
            return resp.status == 200 and receipt.get("recorded") is True and receipt.get("installation_id") == INSTALLATION_ID, latency_ms
    except Exception as e:
        latency_ms = (time.perf_counter() - t0) * 1000.0
        return False, latency_ms


def main():
    parser = argparse.ArgumentParser(description="Compallette Ingestion Benchmark")
    parser.add_argument("--url", default="http://127.0.0.1:8000", help="Backend base URL")
    parser.add_argument("--requests", type=int, default=500, help="Total number of packets to send")
    parser.add_argument("--concurrency", type=int, default=10, help="Number of concurrent client workers")
    parser.add_argument("--isolated", action="store_true", required=True, help="Acknowledge this is an isolated test installation")
    parser.add_argument("--gateway-id", required=True)
    parser.add_argument("--installation-id", required=True)
    parser.add_argument("--key-file", type=Path, required=True, help="Protected file containing this gateway's credential")
    parser.add_argument("--sender-prefix", default="BENCH", help="Prefix of 20 pre-commissioned test devices (PREFIX-000 through PREFIX-019)")
    parser.add_argument("--sequence-start", type=int, default=int(time.time()))
    args = parser.parse_args()
    global API_KEY, GATEWAY_ID, INSTALLATION_ID, SENDER_PREFIX
    API_KEY = args.key_file.read_text(encoding="utf-8").strip()
    GATEWAY_ID, INSTALLATION_ID, SENDER_PREFIX = args.gateway_id, args.installation_id, args.sender_prefix
    if args.requests <= 0 or args.concurrency <= 0 or args.sequence_start <= 0 or args.sequence_start + args.requests > 2147483647:
        parser.error("Choose positive counts and an unexhausted sequence range")

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
            executor.submit(send_packet, args.url, i % 20, args.sequence_start + i)
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
