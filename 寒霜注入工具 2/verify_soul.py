# -*- coding: utf-8 -*-
"""对比 SOUL.md 当前版本与备份，检查寒霜块之外的内容是否完整保留。"""
import io

F = ("/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/"
     "Documents/scripting-agent/soul/SOUL.md")
BAK = F + ".bak-015334"

BEGIN = "<!-- cc-switch-card:--v4 -->"
END = "<!-- /cc-switch-card -->"


def split(path):
    with io.open(path, encoding="utf-8") as f:
        txt = f.read()
    b = txt.find(BEGIN)
    e = txt.find(END)
    if b < 0 or e < 0:
        return txt, None, None
    e_full = e + len(END)
    return txt[:b], txt[b:e_full], txt[e_full:]


cur_head, cur_block, cur_tail = split(F)
bak_head, bak_block, bak_tail = split(BAK)

print("=" * 70)
print("当前 SOUL.md:  %.0f 字节" % (len((cur_head + (cur_block or '') + (cur_tail or '')).encode())))
print("备份 bak-015334: %.0f 字节" % (len((bak_head + (bak_block or '') + (bak_tail or '')).encode())))
print("=" * 70)

for name, a, b in [("块前（人格设定）", cur_head, bak_head),
                   ("块后（其他内容）", cur_tail or "", bak_tail or "")]:
    same = (a == b)
    print("\n%s: %s" % (name, "✅ 完全一致" if same else "❌ 不一致"))
    print("  当前 %d 字节 / 备份 %d 字节" % (len(a.encode()), len(b.encode())))
    if not same:
        import difflib
        diff = list(difflib.unified_diff(
            b.splitlines(), a.splitlines(),
            fromfile="备份", tofile="当前", lineterm="", n=1))
        print("  差异前 40 行:")
        for line in diff[:40]:
            print("   ", line)

print("\n" + "=" * 70)
print("寒霜块: 当前 %d 字节 / 备份 %d 字节" % (
    len((cur_block or "").encode()), len((bak_block or "").encode())))
print("（块内容是有意替换的，不算丢失）")

# 检查备份中块前的章节标题
print("\n=== 当前 SOUL.md 的章节标题 ===")
for line in cur_head.splitlines():
    if line.startswith("#"):
        print("  ", line)

print("\n=== 备份中的章节标题（对照）===")
for line in bak_head.splitlines():
    if line.startswith("#"):
        print("  ", line)
