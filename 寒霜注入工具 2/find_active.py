# -*- coding: utf-8 -*-
"""找出最近活跃的工作区，并检查其 MEMORY.md 状态。"""
import os
import time

DOCS = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents"
MEM_WS = os.path.join(DOCS, "scripting-agent", "memory", "workspaces")
WORK_WS = os.path.join(DOCS, "scripting-agent", "workspace")
BEGIN = "<!-- hanshuang:begin -->"

now = time.time()

print("=== memory/workspaces 最近 15 分钟变动 ===")
rows = []
for n in os.listdir(MEM_WS):
    d = os.path.join(MEM_WS, n)
    if not os.path.isdir(d):
        continue
    # 取目录内最新文件的 mtime
    latest = os.path.getmtime(d)
    for root, _, files in os.walk(d):
        for f in files:
            try:
                latest = max(latest, os.path.getmtime(os.path.join(root, f)))
            except OSError:
                pass
    if now - latest < 900:
        rows.append((latest, n, d))
rows.sort(reverse=True)
for m, n, d in rows[:10]:
    idx = os.path.join(d, "MEMORY.md")
    size = os.path.getsize(idx) if os.path.exists(idx) else 0
    has = False
    if size:
        with open(idx, encoding="utf-8") as f:
            has = BEGIN in f.read()
    print("  %-42s %2d 分钟前  MEMORY=%5d 字节  注入块=%s"
          % (n[:40], int((now - m) / 60), size, has))

print()
print("=== scripting-agent/workspace 最近变动 ===")
if os.path.isdir(WORK_WS):
    rows = []
    for n in os.listdir(WORK_WS):
        d = os.path.join(WORK_WS, n)
        if not os.path.isdir(d):
            continue
        latest = os.path.getmtime(d)
        for root, _, files in os.walk(d):
            for f in files:
                try:
                    latest = max(latest, os.path.getmtime(os.path.join(root, f)))
                except OSError:
                    pass
        if now - latest < 900:
            rows.append((latest, n))
    rows.sort(reverse=True)
    for m, n in rows[:10]:
        print("  %-42s %2d 分钟前" % (n[:40], int((now - m) / 60)))
