#!/usr/bin/env python3
import json, re, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
for r in d.get("requests", [])[:60]:
    u = r.get("URL") or r.get("url") or ""
    print(f"{r.get('id')} {r.get('policyName',''):14s} {r.get('status',''):8s} {u[:110]}")
