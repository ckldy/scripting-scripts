#!/usr/bin/env python3
"""run_single 重启网关 -> 对比实例启动时间 -> 复跑三条链路泄漏检测"""
import json
import subprocess
import sys
import time
import urllib.request

ROOT = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/寒霜注入工具 2"
CHECK = ROOT + "/tests/live_gateway_leak_check.py"
OUT = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-agent/workspaces/寒霜注入工具 2/restart_verify_result.json"


def keepalive():
    try:
        with urllib.request.urlopen("http://127.0.0.1:5190/api/keepalive", timeout=8) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}


before = keepalive()
print("before:", json.dumps(before, ensure_ascii=False)[:300])

# run_single 会终止同脚本的其他实例并启动新实例
for cmd in (
    ["openurl", "scripting://run_single/寒霜注入工具 2"],
    ["open", "scripting://run_single/寒霜注入工具 2"],
):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        print("launch:", cmd[0], "rc=", p.returncode, (p.stdout or "").strip()[:200], (p.stderr or "").strip()[:200])
        if p.returncode == 0:
            break
    except Exception as e:
        print("launch:", cmd[0], "failed:", e)

# 等新实例监听
after = {}
for i in range(20):
    time.sleep(5)
    after = keepalive()
    if after.get("ok") and after.get("keepAlive", {}).get("startTime") != before.get("keepAlive", {}).get("startTime"):
        break

print("after:", json.dumps(after, ensure_ascii=False)[:300])
old_t = before.get("keepAlive", {}).get("startTime")
new_t = after.get("keepAlive", {}).get("startTime")
print("restarted:", old_t != new_t, "old=", old_t, "new=", new_t)

result = {"oldStartTime": old_t, "newStartTime": new_t, "restarted": old_t != new_t}

if old_t != new_t:
    p = subprocess.run([sys.executable, CHECK], capture_output=True, text=True, timeout=900)
    print("check rc=", p.returncode)
    print((p.stdout or "")[:4000])
    print((p.stderr or "")[:1000])
    result["check_stdout"] = (p.stdout or "")[:6000]
    result["check_stderr"] = (p.stderr or "")[:2000]

with open(OUT, "w", encoding="utf-8") as f:
    f.write(json.dumps(result, ensure_ascii=False, indent=2))
print("written:", OUT)
