# -*- coding: utf-8 -*-
"""对比：老工作区 vs 新工作区的配置差异。"""
import json
import os

DOCS = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents"
SESS = os.path.join(DOCS, "scripting-agent", "sessions")
SET = os.path.join(DOCS, "scripting-agent", "settings")
MEM = os.path.join(DOCS, "scripting-agent", "memory", "workspaces")


def dump(label, path):
    print("=" * 70)
    print(label, path)
    if not os.path.exists(path):
        print("  不存在")
        return
    if os.path.isdir(path):
        for n in sorted(os.listdir(path))[:15]:
            p = os.path.join(path, n)
            print("   ", n, os.path.getsize(p) if os.path.isfile(p) else "<dir>")
    else:
        print("  %d 字节" % os.path.getsize(path))
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
            print("  keys:", list(d.keys())[:20] if isinstance(d, dict) else type(d))
        except Exception as e:
            with open(path, encoding="utf-8", errors="replace") as f:
                print("  前 300 字:", f.read(300))


dump("sessions", SESS)
dump("settings", SET)
