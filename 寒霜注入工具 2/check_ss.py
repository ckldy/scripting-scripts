# -*- coding: utf-8 -*-
"""检查新建 80C6B265 工作区的记忆状态。"""
import os

DOCS = ("/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents")
WSID = "80C6B265-6AE5-4F43-88BC-3CB6C86B5919"

mem = os.path.join(DOCS, "scripting-agent", "memory", "workspaces", WSID)
work = os.path.join(DOCS, "scripting-agent", "workspace", WSID)

for label, d in [("memory", mem), ("workspace", work)]:
    print("=== %s ===" % label)
    print(d)
    if not os.path.isdir(d):
        print("  不存在")
        print()
        continue
    for n in sorted(os.listdir(d)):
        p = os.path.join(d, n)
        if os.path.isdir(p):
            print("  [dir] %s -> %s" % (n, os.listdir(p)[:5]))
        else:
            print("  [file] %-30s %d 字节" % (n, os.path.getsize(p)))
    print()

idx = os.path.join(mem, "MEMORY.md")
print("=== MEMORY.md 状态 ===")
if os.path.exists(idx):
    with open(idx, encoding="utf-8") as f:
        t = f.read()
    print("  大小: %d 字节" % len(t.encode()))
    print("  含 hanshuang:begin: %s" % ("hanshuang:begin" in t))
    print("  ---- 前 500 字 ----")
    print(t[:500])
else:
    print("  不存在！")

side = os.path.join(mem, "memories", "hanshuang-armor.md")
print()
print("=== memories/hanshuang-armor.md ===")
print("  存在: %s" % os.path.exists(side))
if os.path.exists(side):
    print("  大小: %d 字节" % os.path.getsize(side))
