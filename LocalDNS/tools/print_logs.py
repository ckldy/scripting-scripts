#!/usr/bin/env python3
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
print("total_items", d.get("pagination", {}).get("total_items"), "returned", len(d.get("logs", [])))
for r in d.get("logs", []):
    print(f"{r.get('duration_ms'):>6} {str(r.get('upstream_tag')):14s} {str(r.get('domain'))[:58]:58s} {r.get('query_time')}")
