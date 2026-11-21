# -*- coding: utf-8 -*-
"""对比 memory/workspaces 与 workspace 两个目录，找出 Agent 真实使用的工作区根。"""
import os
import time

DOCS = ("/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents")
A = os.path.join(DOCS, "scripting-agent", "memory", "workspaces")
B = os.path.join(DOCS, "scripting-agent", "workspace")


def show(label, path):
    print("=== %s ===" % label)
    print(path)
    if not os.path.isdir(path):
        print("  不存在")
        print()
        return
    names = sorted(os.listdir(path))
    dirs = [n for n in names if os.path.isdir(os.path.join(path, n))]
    print("  子目录 %d 个" % len(dirs))
    now = time.time()
    fresh = []
    for n in dirs:
        d = os.path.join(path, n)
        try:
            m = os.path.getmtime(d)
        except OSError:
            continue
        if now - m < 900:
            fresh.append((m, n))
    fresh.sort(reverse=True)
    if fresh:
        print("  最近创建的:")
        for m, n in fresh[:10]:
            age = int((now - m) / 60)
            print("    %-45s %d 分钟前" % (n[:43], age))
    print("  全部（前10）:")
    for n in dirs[:10]:
        sub = os.listdir(os.path.join(path, n))[:5]
        print("    %-45s %s" % (n[:43], sub))
    print()


show("memory/workspaces (记忆)", A)
show("scripting-agent/workspace (会话)", B)

print("=== 两边目录名交集/差集 ===")
if os.path.isdir(A) and os.path.isdir(B):
    sa = {n for n in os.listdir(A) if os.path.isdir(os.path.join(A, n))}
    sb = {n for n in os.listdir(B) if os.path.isdir(os.path.join(B, n))}
    print("  仅 memory/workspaces 有: %d" % len(sa - sb))
    for n in sorted(sa - sb)[:8]:
        print("     ", n)
    print("  仅 workspace 有: %d" % len(sb - sa))
    for n in sorted(sb - sa)[:8]:
        print("     ", n)
    print("  共有: %d" % len(sa & sb))
