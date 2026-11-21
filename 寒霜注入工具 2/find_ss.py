# -*- coding: utf-8 -*-
"""定位新建的 ss 工作区，并列出最近创建/修改的工作区。"""
import os
import time

ROOTS = [
    ("iCloud", "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/"
               "Documents/scripting-agent/memory"),
    ("AppGroup", "/private/var/mobile/Containers/Shared/AppGroup/"
                 "48746BAC-C7A2-4A03-B589-C443A6FA03DC/Documents/scripting-agent/memory"),
    ("LocalDocs", os.path.expanduser("~/Documents/scripting-agent/memory")),
]

print("=== 各根下的 workspaces ===")
for label, root in ROOTS:
    ws = os.path.join(root, "workspaces")
    if not os.path.isdir(ws):
        print("%-10s 无 workspaces 目录: %s" % (label, root))
        continue
    names = [n for n in os.listdir(ws) if os.path.isdir(os.path.join(ws, n))]
    print("%-10s %d 个工作区  %s" % (label, len(names), ws))

print()
print("=== 全局搜含 'ss' 的目录名 ===")
for label, root in ROOTS:
    ws = os.path.join(root, "workspaces")
    if not os.path.isdir(ws):
        continue
    for n in os.listdir(ws):
        if "ss" in n.lower():
            p = os.path.join(ws, n)
            print("  [%s] %s" % (label, n))

print()
print("=== 最近 20 分钟内改动的工作区 ===")
now = time.time()
recent = []
for label, root in ROOTS:
    ws = os.path.join(root, "workspaces")
    if not os.path.isdir(ws):
        continue
    for n in os.listdir(ws):
        d = os.path.join(ws, n)
        if not os.path.isdir(d):
            continue
        try:
            m = os.path.getmtime(d)
        except OSError:
            continue
        if now - m < 1200:
            recent.append((m, label, n, d))
recent.sort(reverse=True)
for m, label, n, d in recent[:20]:
    age = int((now - m) / 60)
    print("  %-10s %-40s %d 分钟前" % (label, n[:38], age))

print()
print("=== 全局记忆根目录的其它位置 ===")
docs = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents"
for sub in ["scripting-agent", ".scripting"]:
    p = os.path.join(docs, sub)
    if os.path.isdir(p):
        print("[%s]" % sub)
        for n in sorted(os.listdir(p))[:15]:
            print("   ", n)
