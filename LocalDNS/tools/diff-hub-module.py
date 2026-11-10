#!/usr/bin/env python3
"""Compare the module body Surge currently holds with what LocalDNS generates now."""
import json
import re
import sys
import hashlib

FRESH = sys.argv[1]
LOADED_RESULT = sys.argv[2]


def load_surge_text(path):
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    dec = json.JSONDecoder()
    outer, _ = dec.raw_decode(raw.lstrip())
    # MCP envelope: {"content":[{"type":"text","text":"<json string>"}]}
    inner_raw = outer["content"][0]["text"]
    inner = json.loads(inner_raw)
    return inner["text"], inner


def sections(text):
    out = {}
    cur = "__preamble__"
    out[cur] = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("[") and s.endswith("]"):
            cur = s[1:-1]
            out.setdefault(cur, [])
            continue
        if not s or s.startswith("#") or s.startswith("//"):
            continue
        out[cur].append(s)
    return out


def normalize(line):
    return re.sub(r"\[Build: [^\]]+\]", "[Build: X]", line)


fresh_text = open(FRESH, "r", encoding="utf-8").read()
loaded_text, loaded_meta = load_surge_text(LOADED_RESULT)

fa = sections(fresh_text)
fb = sections(loaded_text)

print("fresh bytes=%d  loaded bytes=%d" % (len(fresh_text), len(loaded_text)))
print("loaded updated-at=%s" % loaded_meta.get("updated-at"))
print("loaded sections(meta)=%s" % json.dumps(loaded_meta.get("sections"), ensure_ascii=False, sort_keys=True))

names = sorted(set(fa) | set(fb))
diffs = 0
for n in names:
    a = fa.get(n, [])
    b = fb.get(n, [])
    same = [normalize(x) for x in a] == [normalize(x) for x in b]
    if not same:
        diffs += 1
        only_fresh = [x for x in a if normalize(x) not in [normalize(y) for y in b]]
        only_loaded = [x for x in b if normalize(x) not in [normalize(y) for y in a]]
        print("\n=== [%s] DIFF fresh=%d loaded=%d" % (n, len(a), len(b)))
        for x in only_fresh[:12]:
            print("  + %s" % x[:200])
        for x in only_loaded[:12]:
            print("  - %s" % x[:200])
    else:
        print("[%s] identical (%d lines)" % (n, len(a)))

print("\nVERDICT: %s" % ("STALE - body differs" if diffs else "IDENTICAL - module body in sync"))
