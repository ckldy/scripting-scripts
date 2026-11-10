#!/usr/bin/env python3
"""Phase 0: backup DB/config and capture DNS golden baseline. No runtime changes."""
import hashlib
import json
import os
import shutil
import sqlite3
import time
import urllib.request

APP = "/var/mobile/Containers/Shared/AppGroup/8C8228F0-EECE-4A41-A8A8-333951C28E7C/Documents"
PROJECT = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/LocalDNS"
DB = f"{APP}/LocalDNS/surge_link.db"
OUT = f"{PROJECT}/backup/20261107"
SURGE_API = "http://127.0.0.1:6166"
LOCAL_API = "http://127.0.0.1:9099"

DOMAINS = [
    "magsrv.com", "11yun.xyz", "epidermispushupvariable.com", "pemsrv.com", "googletagmanager.com",
    "ads.youtube.com", "pagead2.googlesyndication.com", "googleads.g.doubleclick.net",
    "mobads.baidu.com", "adservice.google.com",
    "s.youtube.com", "s2.youtube.com", "video-stats.l.google.com", "video-stats.youtube.com",
    "stats_check.youtube.com",
    "www.youtube.com", "m.youtube.com", "youtubei.googleapis.com", "i.ytimg.com",
    "redirector.googlevideo.com",
    "www.baidu.com", "www.qq.com", "www.bilibili.com", "www.taobao.com", "weibo.com",
    "www.google.com", "github.com", "cloudflare.com", "example.com",
    "xn--fiqs8s", "www.youtube.com.", "WWW.YOUTUBE.COM",
    "lf-ad-ies.bytecdn.cn", "extlog.snssdk.com", "bds.snssdk.com",
    "api.pinduoduo.com", "acs.m.goofish.com",
]


def get(url, headers=None, timeout=12):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    os.makedirs(OUT, exist_ok=True)

    # 1) Consistent DB backup via VACUUM INTO (WAL-safe)
    db_backup = f"{OUT}/surge_link.db"
    if os.path.exists(db_backup):
        os.remove(db_backup)
    conn = sqlite3.connect(DB)
    conn.execute("VACUUM INTO ?", (db_backup,))
    conn.close()

    # 2) Key code/module snapshots
    copies = [
        (f"{PROJECT}/web/hub-full.sgmodule", f"{OUT}/hub-full.sgmodule"),
        (f"{PROJECT}/web/hub-safe.sgmodule", f"{OUT}/hub-safe.sgmodule"),
        (f"{PROJECT}/script.json", f"{OUT}/script.json"),
        (f"{PROJECT}/src/surge-service.ts", f"{OUT}/surge-service.ts"),
        (f"{PROJECT}/src/surge-db.ts", f"{OUT}/surge-db.ts"),
        (f"{PROJECT}/src/diversion.ts", f"{OUT}/diversion.ts"),
        (f"{PROJECT}/src/resolver.ts", f"{OUT}/resolver.ts"),
    ]
    for src, dst in copies:
        if os.path.exists(src):
            shutil.copy2(src, dst)

    # 3) Live Surge/LocalDNS state
    headers = {"X-Key": "vcncvkey"}
    state = {}
    for name, url, hdrs in [
        ("profile", f"{SURGE_API}/v1/profiles/current", headers),
        ("modules", f"{SURGE_API}/v1/modules", headers),
        ("hub", f"{LOCAL_API}/surge/hub.sgmodule", {}),
        ("block_list", f"{LOCAL_API}/rules/block.list", {}),
        ("status", f"{LOCAL_API}/api/v1/status", {}),
        ("hub_health", f"{LOCAL_API}/api/v1/surge/hub-health", {}),
    ]:
        try:
            raw = get(url, hdrs, timeout=20)
            state[name] = raw
            ext = ".json" if name in ("modules", "status", "hub_health") else ".txt"
            with open(f"{OUT}/{name}{ext}", "wb") as f:
                f.write(raw)
        except Exception as e:
            state[name] = f"ERROR: {e}".encode()

    # 4) DNS golden
    golden = []
    for d in DOMAINS:
        try:
            raw = get(f"{LOCAL_API}/api/resolve?name={urllib.parse.quote(d)}&type=1", {}, timeout=15)
            data = json.loads(raw)
            golden.append({
                "domain": d,
                "blocked": data.get("blocked"),
                "domain_set": data.get("domain_set"),
                "addresses": data.get("addresses"),
            })
        except Exception as e:
            golden.append({"domain": d, "error": str(e)})
        time.sleep(0.05)
    with open(f"{OUT}/dns-golden.json", "w", encoding="utf-8") as f:
        json.dump(golden, f, ensure_ascii=False, indent=2)

    # 5) Hashes
    hashes = {}
    for name in ("surge_link.db", "hub-full.sgmodule", "hub-safe.sgmodule", "profile.txt",
                 "block_list.txt", "hub.txt", "script.json", "surge-service.ts",
                 "surge-db.ts", "diversion.ts", "resolver.ts", "dns-golden.json"):
        p = f"{OUT}/{name}"
        if os.path.exists(p):
            hashes[name] = {"sha256": sha(p), "bytes": os.path.getsize(p)}
    with open(f"{OUT}/manifest.json", "w", encoding="utf-8") as f:
        json.dump({"created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "hashes": hashes}, f, ensure_ascii=False, indent=2)

    print(json.dumps({
        "out": OUT,
        "db_bytes": os.path.getsize(db_backup),
        "dns_entries": len(golden),
        "blocked": sum(1 for g in golden if g.get("blocked") is True),
        "hashes": hashes,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
