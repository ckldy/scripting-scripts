#!/usr/bin/env python3
import json, sys, statistics, collections
d = json.load(open(sys.argv[1], encoding="utf-8"))
logs = d.get("logs") or d.get("data") or []
print("keys:", list(d.keys())[:10], "logs:", len(logs))
if not logs:
    sys.exit(0)
print("sample:", json.dumps(logs[0], ensure_ascii=False)[:400])

def get(r, *names, default=""):
    for n in names:
        if n in r and r[n] is not None:
            return r[n]
    return default

yt = [r for r in logs if "googlevideo" in str(get(r, "domain", "Domain")) or "youtube" in str(get(r, "domain", "Domain")) or "ytimg" in str(get(r, "domain", "Domain"))]
print(f"\nyoutube-family logs: {len(yt)}")
cold = []
for r in yt:
    dur = get(r, "duration_ms", "durationMs", "duration", default=0)
    up = get(r, "upstream_tag", "upstreamTag", "upstream")
    print(f"{str(dur):>6} {str(up):16s} {str(get(r,'domain','Domain'))[:55]:55s} {str(get(r,'domain_set','domainSet'))}")
    if up and "cache" not in str(up):
        cold.append(int(dur))
if cold:
    print("\ncold n=%d median=%.0f mean=%.0f max=%d" % (len(cold), statistics.median(cold), sum(cold)/len(cold), max(cold)))
