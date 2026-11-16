#!/usr/bin/env python3
import json, sys, statistics
d = json.load(open(sys.argv[1], encoding="utf-8"))
flows = d.get("recent_flows", [])
cold = [f for f in flows if not f.get("cached")]
warm = [f for f in flows if f.get("cached")]
print(f"flows={len(flows)} cold={len(cold)} warm={len(warm)}")
if cold:
    ds = sorted(f["duration_ms"] for f in cold)
    print("cold dur ms:", ds)
    print("cold median=%.0f mean=%.0f max=%d" % (statistics.median(ds), sum(ds)/len(ds), ds[-1]))
by_node = {}
for f in cold:
    by_node.setdefault(f.get("upstream_node"), []).append(f["duration_ms"])
for k, v in sorted(by_node.items(), key=lambda kv: -len(kv[1])):
    print(f"  node={k}: n={len(v)} mean={sum(v)/len(v):.0f}ms max={max(v)}ms")
for f in flows:
    print(f"{f['duration_ms']:6d}ms cached={str(f.get('cached'))[:5]:5s} {f.get('upstream_node',''):14s} {f['domain'][:60]}")
