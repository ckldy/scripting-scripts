# -*- coding: utf-8 -*-
"""对比 E28CFC2C（生效）与新工作区（不生效）的 MEMORY.md 结构差异。"""
import os

DOCS = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents"
WS = os.path.join(DOCS, "scripting-agent", "memory", "workspaces")

targets = [
    ("E28CFC2C (手动内联，已生效)", "E28CFC2C-DA08-4B25-9CB6-8CABC12631CE"),
    ("70CF8294 (脚本生成，未生效)", "70CF8294-BE33-4987-959F-E4F1309BD5E7"),
    ("F93910B3 (脚本生成，未生效)", "F93910B3-9E4D-4919-B301-F8C69A77A306"),
    ("80C6B265 (脚本生成，未生效)", "80C6B265-6AE5-4F43-88BC-3CB6C86B5919"),
]

for label, wid in targets:
    p = os.path.join(WS, wid, "MEMORY.md")
    print("=" * 70)
    print(label)
    if not os.path.exists(p):
        print("  不存在")
        continue
    with open(p, encoding="utf-8") as f:
        t = f.read()
    print("  大小: %d 字节" % len(t.encode()))
    print("  前 3 行:")
    for i, line in enumerate(t.split("\n")[:3]):
        print("    [%d] %r" % (i, line[:70]))
    # 找注入块起止
    b = t.find("<!-- hanshuang:begin -->")
    e = t.find("<!-- hanshuang:end -->")
    print("  注入块: begin@%d end@%d" % (b, e))
    print("  块前内容长度: %d" % (b if b >= 0 else -1))
    if b >= 0:
        print("  块前内容: %r" % t[:b][:120])
