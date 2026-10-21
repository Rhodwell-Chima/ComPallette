#!/usr/bin/env python3
"""
COMPALLETTE SUBTERRANEAN MESH NETWORK SIMULATOR
===============================================
Simulates multiple underground ESP32 nodes (Wearable Tags and Stationary Anchors)
operating within a mine tunnel network. Emits protocol v1 packets, demonstrates
immediate emergency alert handling (falls, gas spikes), and provides realistic
telemetry streams for testing gateways, backends, and dashboards without requiring
physical ESP32 hardware.
"""

import argparse
import json
import random
import sys
import time

PROTOCOL_VERSION = 1

ANCHORS = [
    {"id": "ANCHOR-SHAFT1-SURFACE", "zone": "SURFACE-PORTAL"},
    {"id": "ANCHOR-LVL1-STATION",   "zone": "LEVEL-1-STATION"},
    {"id": "ANCHOR-LVL2-NORTH",     "zone": "LEVEL-2-NORTH-DRIFT"},
    {"id": "ANCHOR-LVL2-HAULAGE",   "zone": "LEVEL-2-HAULAGE-WAY"},
    {"id": "ANCHOR-LVL3-STOPE",     "zone": "LEVEL-3-ACTIVE-STOPE"},
]

MINERS = [
    {"id": "MINER-101", "name": "Moses Banda",    "current_zone": "LEVEL-2-NORTH-DRIFT"},
    {"id": "MINER-106", "name": "Chileshe Phiri",  "current_zone": "LEVEL-3-ACTIVE-STOPE"},
    {"id": "MINER-112", "name": "Peter Mwape",     "current_zone": "LEVEL-2-HAULAGE-WAY"},
]


def generate_telemetry_packet(miner, seq, uptime_ms, trigger_hazard=False):
    """Generates a standard v1 TELEMETRY packet."""
    if trigger_hazard:
        co = round(random.uniform(52.0, 85.0), 1)  # Hazardous CO level (>50 ppm)
        fall = True
    else:
        co = round(random.uniform(8.0, 24.0), 1)   # Safe/Normal CO level
        fall = False

    return {
        "ver": PROTOCOL_VERSION,
        "type": "TELEMETRY",
        "seq": seq,
        "sender": miner["id"],
        "role": "WEARABLE",
        "zone": miner["current_zone"],
        "uptime": uptime_ms,
        "payload": {
            "co": co,
            "temp": round(random.uniform(27.0, 31.5), 1),
            "hum": round(random.uniform(72.0, 88.0), 1),
            "fall": fall,
            "batt": round(max(3.2, 3.9 - (uptime_ms / 3600000.0) * 0.1), 2),
            "sim": True,
            "ok": True,
        },
    }


def generate_alert_packet(miner, seq, uptime_ms, alert_code, severity, details, trigger_val):
    """Generates an immediate event-driven v1 ALERT packet."""
    return {
        "ver": PROTOCOL_VERSION,
        "type": "ALERT",
        "seq": seq,
        "sender": miner["id"],
        "role": "WEARABLE",
        "zone": miner["current_zone"],
        "uptime": uptime_ms,
        "payload": {
            "severity": severity,
            "code": alert_code,
            "details": details,
            "val": trigger_val,
        },
    }


def generate_heartbeat_packet(node_id, role, zone, seq, uptime_ms, visible_nodes):
    """Generates a v1 HEARTBEAT packet."""
    return {
        "ver": PROTOCOL_VERSION,
        "type": "HEARTBEAT",
        "seq": seq,
        "sender": node_id,
        "role": role,
        "zone": zone,
        "uptime": uptime_ms,
        "payload": {
            "heap": random.randint(165000, 195000),
            "nodes": visible_nodes,
            "batt": round(random.uniform(3.75, 4.05), 2),
        },
    }


def run_simulation(duration_seconds=30, interval_seconds=2.0):
    print("=" * 70)
    print("  COMPALLETTE UNDERGROUND MESH NETWORK SIMULATOR (Protocol v1)  ")
    print("=" * 70)
    print(f"[*] Simulating {len(MINERS)} wearable miner tags and {len(ANCHORS)} stationary anchors.")
    print(f"[*] Update Interval: {interval_seconds}s | Run Duration: {duration_seconds}s")
    print("=" * 70)

    start_time = time.time()
    seq_counter = {m["id"]: 0 for m in MINERS}
    anchor_seq = {a["id"]: 0 for a in ANCHORS}
    cycle = 0

    try:
        while time.time() - start_time < duration_seconds:
            cycle += 1
            elapsed_ms = int((time.time() - start_time) * 1000)

            # 1. Periodic Telemetry from Wearable Miners
            for miner in MINERS:
                seq_counter[miner["id"]] += 1
                seq = seq_counter[miner["id"]]

                # Occasionally simulate miner roaming to an adjacent tunnel zone
                if random.random() < 0.15:
                    new_anchor = random.choice(ANCHORS)
                    miner["current_zone"] = new_anchor["zone"]

                # 5% chance of spontaneous hazard breach in simulation
                hazard = (random.random() < 0.05)
                telem_pkt = generate_telemetry_packet(miner, seq, elapsed_ms, trigger_hazard=hazard)

                # If hazard triggered, emit immediate alert packet FIRST (event-driven)
                if hazard:
                    seq_counter[miner["id"]] += 1
                    alert_pkt = generate_alert_packet(
                        miner,
                        seq_counter[miner["id"]],
                        elapsed_ms,
                        alert_code="GAS_CO_CRITICAL" if telem_pkt["payload"]["co"] > 50 else "MAN_DOWN",
                        severity="CRITICAL",
                        details=f"Spike of {telem_pkt['payload']['co']} ppm CO detected in {miner['current_zone']}",
                        trigger_val=telem_pkt["payload"]["co"],
                    )
                    print("\n" + "!" * 70)
                    print(f" [CRITICAL EMERGENCY ALERT DETECTED]")
                    print(f" --> Origin: {miner['id']} ({miner['name']}) | Zone: {miner['current_zone']}")
                    print(f" --> Payload: {json.dumps(alert_pkt)}")
                    print("!" * 70)

                # Regular telemetry output
                co_val = telem_pkt["payload"]["co"]
                status_badge = "[CRIT]" if co_val >= 50 else "[WARN]" if co_val >= 25 else "[NORM]"
                print(f"[TX TELEMETRY #{seq:03d}] {miner['id']} @ {miner['current_zone']:<24} | CO: {co_val:>4.1f} ppm {status_badge} | Batt: {telem_pkt['payload']['batt']}V")

            # 2. Periodic Anchor Node Heartbeat (every 5 cycles)
            if cycle % 5 == 0:
                for anchor in ANCHORS:
                    anchor_seq[anchor["id"]] += 1
                    hb_pkt = generate_heartbeat_packet(
                        anchor["id"],
                        "ANCHOR",
                        anchor["zone"],
                        anchor_seq[anchor["id"]],
                        elapsed_ms,
                        visible_nodes=len(MINERS) + len(ANCHORS) - 1,
                    )
                    print(f"[HEARTBEAT] {anchor['id']} ({anchor['zone']}) | Heap: {hb_pkt['payload']['heap']} B | Peers: {hb_pkt['payload']['nodes']}")

            time.sleep(interval_seconds)

    except KeyboardInterrupt:
        print("\nSimulation aborted by user.")

    print("\n" + "=" * 70)
    print("Simulation session completed.")
    print("=" * 70)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compallette Mesh Network Simulator")
    parser.add_argument("--duration", type=int, default=10, help="Run duration in seconds")
    parser.add_argument("--interval", type=float, default=2.0, help="Packet interval in seconds")
    args = parser.parse_args()

    run_simulation(duration_seconds=args.duration, interval_seconds=args.interval)
