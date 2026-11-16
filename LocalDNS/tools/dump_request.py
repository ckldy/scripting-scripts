#!/usr/bin/env python3
import json, sys, re
d = json.load(open(sys.argv[1], encoding="utf-8"))
pat = re.compile(sys.argv[2])
for r in d.get("requests", []):
    u = r.get("URL") or r.get("url") or ""
    if not pat.search(u):
        continue
    print("=" * 70)
    print(u[:160])
    print(f"policy={r.get('policyName')} status={r.get('status')} in={r.get('inBytes')} out={r.get('outBytes')}")
    t0 = None
    for n in r.get("notes", []):
        m = re.match(r"^(\d\d):(\d\d):(\d\d)\.(\d+)\s+(.*)$", n)
        if not m:
            print("   ", n)
            continue
        t = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + float("0." + m.group(4))
        if t0 is None:
            t0 = t
        print(f"   +{t - t0:6.3f}s  {m.group(5)}")
