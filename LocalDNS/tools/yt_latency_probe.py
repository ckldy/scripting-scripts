#!/usr/bin/env python3
"""Analyze Surge /v1/requests/recent notes to find slow phases for YouTube traffic."""
import json
import re
import sys
from collections import defaultdict

path = sys.argv[1]
data = json.load(open(path, encoding="utf-8"))
reqs = data.get("requests", [])

TS = re.compile(r"^(\d\d):(\d\d):(\d\d)\.(\d+)\s+(.*)$")


def to_sec(h, m, s, frac):
    return int(h) * 3600 + int(m) * 60 + int(s) + float("0." + frac)


rows = []
for r in reqs:
    url = r.get("URL") or r.get("url") or ""
    notes = r.get("notes") or []
    ts = []
    for n in notes:
        m = TS.match(n)
        if m:
            ts.append((to_sec(*m.groups()[:4]), m.group(5)))
    if not ts:
        continue
    host = ""
    hm = re.match(r"https?://([^/:?#]+)", url)
    if hm:
        host = hm.group(1)
    start = ts[0][0]
    phases = {}
    for t, msg in ts:
        if "Connected to address" in msg or "TCP connection established" in msg:
            phases.setdefault("connect", t - start)
        if "TLS handshake" in msg.lower() and "finish" in msg.lower():
            phases.setdefault("tls", t - start)
        if "[HTTP] Sent request" in msg or "Sent HTTP request" in msg:
            phases.setdefault("req", t - start)
        if "Received response" in msg or "response header" in msg.lower():
            phases.setdefault("resp", t - start)
    dur = ts[-1][0] - start
    rows.append((host, url, start, dur, phases, r.get("policyName"), r.get("status")))

rows.sort(key=lambda x: x[2])

yt = [r for r in rows if "youtube" in r[0] or "googlevideo" in r[0] or "ytimg" in r[0] or "ggpht" in r[0]]
print(f"total requests with notes: {len(rows)}  youtube-family: {len(yt)}")
print("\n== per-request detail (youtube family) ==")
for host, url, start, dur, ph, pol, st in yt[-40:]:
    p = " ".join(f"{k}={v:.2f}s" for k, v in sorted(ph.items()))
    print(f"{start:9.3f} dur={dur:6.2f}s pol={pol:12s} {host:38s} {p}")

print("\n== host aggregates ==")
agg = defaultdict(list)
for host, url, start, dur, ph, pol, st in yt:
    agg[host].append((dur, ph.get("connect"), ph.get("tls"), ph.get("resp")))

for host, vals in sorted(agg.items(), key=lambda kv: -max(v[0] for v in kv[1]))[:20]:
    n = len(vals)
    maxd = max(v[0] for v in vals)
    avgconn = [v[1] for v in vals if v[1] is not None]
    print(f"{host:40s} n={n:3d} max={maxd:6.2f}s avg_conn={(sum(avgconn)/len(avgconn) if avgconn else -1):5.2f}s")
