# -*- coding: utf-8 -*-
"""校验寒霜准则的“全局单一真源”状态。

判定标准（2026-11-20 起）：
  1. 全局 memory/MEMORY.md 里恰好 1 个 hanshuang 块 —— 这是唯一真源，任何工作区都会注入；
  2. 工作区 MEMORY.md 不允许再有该块 —— 有就是重复副本，白占 token，跑 sync_armor.py --strip。
"""
import io
import os

AGENT = ("/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/"
         "Documents/scripting-agent")
GLOBAL_MD = os.path.join(AGENT, "memory", "MEMORY.md")
WS = os.path.join(AGENT, "memory", "workspaces")

BEGIN = "<!-- hanshuang:begin -->"
END = "<!-- hanshuang:end -->"

problems = []

gtxt = io.open(GLOBAL_MD, encoding="utf-8").read() if os.path.exists(GLOBAL_MD) else ""
gb, ge = gtxt.count(BEGIN), gtxt.count(END)
print("全局层: %s, begin=%d end=%d, %d 字节" % (
    "存在" if gtxt else "缺失", gb, ge, len(gtxt.encode())))
if gb != 1 or ge != 1:
    problems.append("全局层块数量异常 begin=%d end=%d" % (gb, ge))

rows = []
dups = []
for name in sorted(os.listdir(WS)):
    d = os.path.join(WS, name)
    if not os.path.isdir(d) or name.startswith("."):
        continue
    p = os.path.join(d, "MEMORY.md")
    if not os.path.exists(p):
        rows.append((0, name, "无文件"))
        continue
    txt = io.open(p, encoding="utf-8").read()
    size = len(txt.encode())
    if BEGIN in txt or END in txt:
        dups.append(name)
    rows.append((size, name, "含副本" if BEGIN in txt else "自有记忆"))

rows.sort()
print("工作区 %d 个｜残留副本 %d 个｜最空的 3 个: %s" % (
    len(rows), len(dups), ", ".join("%s(%dB)" % (n, s) for s, n, _ in rows[:3])))
if dups:
    problems.append("%d 个工作区仍含重复块，跑 sync_armor.py --strip" % len(dups))

print()
if problems:
    print("问题 %d 个:" % len(problems))
    for p in problems:
        print("  - " + p)
else:
    print("全部正常：全局层单一真源在位，工作区无重复副本 → 新建工作区自动生效")
