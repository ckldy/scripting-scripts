# -*- coding: utf-8 -*-
"""寒霜准则注入器（全局单一真源）。

原理：
  应用新建工作区时只会写一份空模板 MEMORY.md，不会带任何规则；
  而 `scripting-agent/memory/MEMORY.md`（全局层）在**每个工作区**的每个会话都会注入。
  所以准则只放在全局层，工作区层不再各存一份副本 —— 新工作区天然生效。

用法：
  python3 sync_armor.py                 # 把模板块写入/刷新到全局 MEMORY.md
  python3 sync_armor.py --check         # 只检查：全局块 + 工作区残留副本
  python3 sync_armor.py --strip         # 备份后清掉各工作区的重复块（保留块外记忆）
  python3 sync_armor.py --restore-workspaces   # 回滚：把块重新写回每个工作区
"""
import io
import os
import shutil
import sys
import time

AGENT = ("/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/"
         "Documents/scripting-agent")
GLOBAL_MD = os.path.join(AGENT, "memory", "MEMORY.md")
WS_ROOT = os.path.join(AGENT, "memory", "workspaces")
HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "prompts", "armor-block-v4.md")
BACKUP_ROOT = os.path.join(HERE, "data", "backups")

BEGIN = "<!-- hanshuang:begin -->"
END = "<!-- hanshuang:end -->"
HEADER = "# MEMORY.md\n\n"
INDEX_NOTE = (
    "Index of memories — one line each: `- [Title](memories/slug.md) — hook`.\n"
    "Detail lives in the sibling `memories/` directory, one fact per file. "
    "Keep this index concise; prune entries that go stale.\n")


def read(path):
    with io.open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def load_block():
    if not os.path.exists(TEMPLATE):
        raise SystemExit("错误：模板不存在 %s" % TEMPLATE)
    txt = read(TEMPLATE)
    i, j = txt.find(BEGIN), txt.find(END)
    if i < 0 or j < i:
        raise SystemExit("错误：模板缺少 begin/end 标记")
    return txt[i:j + len(END)].rstrip() + "\n"


def drop_blocks(text):
    """删除所有注入块（含残缺块），返回 (剩余文本, 删除个数)。"""
    n = 0
    while True:
        i = text.find(BEGIN)
        if i < 0:
            return text, n
        j = text.find(END, i)
        if j < 0:
            return text[:i].rstrip("\n") + "\n", n + 1
        text = text[:i] + text[j + len(END):]
        n += 1


def put_global(block):
    if not os.path.exists(GLOBAL_MD):
        write(GLOBAL_MD, HEADER + block + "\n" + INDEX_NOTE)
        return "新建"
    txt = read(GLOBAL_MD)
    had = txt.count(BEGIN)
    txt, _ = drop_blocks(txt)
    if txt.startswith("# MEMORY.md"):
        nl = txt.find("\n")
        head, rest = txt[:nl + 1], txt[nl + 1:]
        txt = head + "\n" + block + "\n" + rest.lstrip("\n")
    else:
        txt = block + "\n\n" + txt
    write(GLOBAL_MD, txt)
    return "刷新(原有 %d 份)" % had if had else "补入"


def workspaces():
    if not os.path.isdir(WS_ROOT):
        return []
    out = []
    for name in sorted(os.listdir(WS_ROOT)):
        d = os.path.join(WS_ROOT, name)
        if os.path.isdir(d) and not name.startswith("."):
            out.append((name, os.path.join(d, "MEMORY.md")))
    return out


def backup_all():
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dst = os.path.join(BACKUP_ROOT, "workspaces-strip-%s" % stamp)
    os.makedirs(dst, exist_ok=True)
    n = 0
    for name, p in workspaces():
        if os.path.exists(p):
            shutil.copy2(p, os.path.join(dst, name + ".md"))
            n += 1
    return dst, n


def strip_workspaces():
    dst, n = backup_all()
    cleaned = 0
    kept_bytes = 0
    for name, p in workspaces():
        if not os.path.exists(p):
            continue
        txt = read(p)
        if BEGIN not in txt:
            continue
        rest, cnt = drop_blocks(txt)
        if not rest.strip():
            rest = HEADER + INDEX_NOTE
        write(p, rest)
        cleaned += 1
        kept_bytes += len(rest.encode())
    print("备份 %d 个文件 → %s" % (n, dst))
    print("已清理 %d 个工作区的重复块，块外记忆保留（合计 %d 字节）" % (cleaned, kept_bytes))


def restore_workspaces(block):
    touched = 0
    for name, p in workspaces():
        if not os.path.exists(p):
            write(p, HEADER + block + "\n" + INDEX_NOTE)
            touched += 1
            continue
        txt = read(p)
        if txt.count(BEGIN) == 1 and txt.count(END) == 1:
            continue
        txt, _ = drop_blocks(txt)
        if txt.startswith("# MEMORY.md"):
            nl = txt.find("\n")
            txt = txt[:nl + 1] + "\n" + block + "\n" + txt[nl + 1:].lstrip("\n")
        else:
            txt = block + "\n\n" + txt
        write(p, txt)
        touched += 1
    print("已回写 %d 个工作区" % touched)


def check():
    ok = True
    if not os.path.exists(GLOBAL_MD):
        print("❌ 全局 MEMORY.md 不存在")
        ok = False
    else:
        txt = read(GLOBAL_MD)
        nb, ne = txt.count(BEGIN), txt.count(END)
        print("全局层: begin=%d end=%d, %d 字节" % (nb, ne, len(txt.encode())))
        if nb != 1 or ne != 1:
            ok = False
            print("❌ 全局块异常")
    dup = []
    for name, p in workspaces():
        if os.path.exists(p) and BEGIN in read(p):
            dup.append(name)
    print("工作区残留副本: %d 个%s" % (len(dup), "" if not dup else " → " + ", ".join(dup[:5])))
    if dup:
        print("⚠️ 有副本说明还会重复占 token，跑 --strip 清理")
    print("结论: %s" % ("正常（单一真源在全局层，新工作区天然生效）" if ok and not dup else "需处理"))


def main():
    args = set(sys.argv[1:])
    block = load_block()
    if "--check" in args:
        check()
        return
    if "--strip" in args:
        strip_workspaces()
        return
    if "--restore-workspaces" in args:
        restore_workspaces(block)
        return
    step = put_global(block)
    print("全局层已%s，块 %d 字节" % (step, len(block.encode())))
    check()


if __name__ == "__main__":
    main()
