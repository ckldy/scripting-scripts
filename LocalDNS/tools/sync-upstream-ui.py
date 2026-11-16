#!/usr/bin/env python3
"""把上游 ui/ 目录精确同步进本地 web/，并重放全部本地定制。

用法：
  python3 tools/sync-upstream-ui.py latest                  # 自动取 GitHub 最新发行版
  python3 tools/sync-upstream-ui.py fjn8c-ui-v2026.11.08.4   # 直接按 tag 下载
  python3 tools/sync-upstream-ui.py <upstream-ui-dir>        # 已解包的 ui/ 目录

做的事：
  1. 备份当前 app-*.js / index-*.css / index.html / version.json / build-meta.json
  2. 删除旧打包文件，复制新打包文件，重放 app bundle 的 7 处 Surge 补丁
  3. 复制 fonts / img / help / build-meta.json，重写 version.json（后端标识 FJMOS）
  4. 以上游 index.html 为基底重放三处本地定制（本地脚本、AdHunter 入口、FJMOS 徽标）
  5. 保留 editor（补丁幂等重放）、config.js 与本地 assets
  6. 收尾自检：补丁特征串、index.html 定制、打包文件唯一性；任一不符即硬失败
"""
import datetime
import hashlib
import json
import os
import re
import shutil
import sys
import urllib.request
import zipfile

ROOT = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/LocalDNS"
WEB = os.path.join(ROOT, "web")
APP_GROUP = "/var/mobile/Containers/Shared/AppGroup/8C8228F0-EECE-4A41-A8A8-333951C28E7C/Documents/scripting-agent"
SPEC = os.path.join(APP_GROUP, "patch_spec.json")

LIVEPULSE = '  <script src="/ui/assets/livepulse.js?v=20261105-v2" defer></script>\n' \
            '  <script src="/ui/assets/surge-workbench.js?v=20261116-v1" defer></script>\n'
ADHUNTER = (
    '          <a href="/ui/ad-hunter.html" target="_blank" class="version-button" style="text-decoration:none;'
    'display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(59,130,246,0.15);'
    'border:1px solid rgba(59,130,246,0.3);border-radius:18px;color:#93c5fd;font-size:12px;font-weight:600;" '
    'title="打开 AdHunter 智能去广告实验室">\n'
    '            <span>🛡️ 去广告实验室</span>\n'
    '          </a>\n'
)
DOCK_ANCHOR = '        <div class="top-actions-dock">\n'
# 上游内核代号会随发行线变（FJN01 → FJN8C …），徽标锚点按模式匹配，不再写死某一代号
BRAND_RE = re.compile(r'data-backend-version="FJN[0-9A-Z]+">FJN[0-9A-Z]+<')
BRAND_NEW = 'data-backend-version="FJMOS">FJMOS<'
TAG_RE = re.compile(r"^[a-z0-9]+-ui-v\d{4}\.\d{2}\.\d{2}(\.\d+)?$")


def sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read().replace("\r\n", "\n").replace("\r", "\n")


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def one(pattern_dir, prefix, suffix):
    names = [n for n in os.listdir(pattern_dir) if n.startswith(prefix) and n.endswith(suffix)]
    if len(names) != 1:
        raise SystemExit("期望 %s*%s 恰好一个，实际 %s" % (prefix, suffix, names))
    return names[0]


def resolve_latest():
    """从 GitHub API 取最新正式发行版 tag，避免手工抄写版本号。"""
    url = "https://api.github.com/repos/yyhoworks/LocalDNS/releases/latest"
    req = urllib.request.Request(url, headers={"User-Agent": "Scripting"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        tag = json.load(resp)["tag_name"]
    print("最新发行版：", tag)
    return tag


def fetch_release(tag):
    """按 tag 下载 LocalDNS_UI_<ver>_Update.zip 并解包，返回其中的 ui/ 目录。"""
    version = tag.split("-v")[-1]
    base = "https://github.com/yyhoworks/LocalDNS/releases/download/%s" % tag
    url = base + "/LocalDNS_UI_%s_Update.zip" % version
    dest = os.path.join(APP_GROUP, "upstream", version)
    os.makedirs(dest, exist_ok=True)
    zip_path = os.path.join(dest, os.path.basename(url))
    if not os.path.exists(zip_path) or os.path.getsize(zip_path) < 1000000:
        print("下载", url)
        req = urllib.request.Request(url, headers={"User-Agent": "Scripting"})
        with urllib.request.urlopen(req, timeout=180) as resp, open(zip_path, "wb") as fh:
            shutil.copyfileobj(resp, fh)
    verify_checksum(base, zip_path)
    out = os.path.join(dest, "extracted")
    if not os.path.isdir(os.path.join(out, "ui")):
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(out)
    return os.path.join(out, "ui")


def verify_checksum(base, zip_path):
    """用发行版 SHA256SUMS.txt 校验安装包；拿不到校验表时明确告警（不静默跳过）。"""
    name = os.path.basename(zip_path)
    try:
        req = urllib.request.Request(base + "/SHA256SUMS.txt", headers={"User-Agent": "Scripting"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            sums = resp.read().decode("utf-8", "replace")
    except Exception as exc:
        print("  警告：无法获取 SHA256SUMS.txt（%s），跳过校验" % exc)
        return
    expected = None
    for line in sums.splitlines():
        parts = line.strip().split()
        if len(parts) >= 2 and os.path.basename(parts[-1]) == name:
            expected = parts[0].lower()
            break
    if not expected:
        print("  警告：SHA256SUMS.txt 不含 %s，跳过校验" % name)
        return
    actual = sha(zip_path)
    if actual != expected:
        raise SystemExit("安装包校验失败：%s\n  期望 %s\n  实际 %s" % (name, expected, actual))
    print("  校验通过 %s（%s）" % (name, actual[:16]))


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    up = sys.argv[1]
    if up in ("latest", "--latest"):
        up = resolve_latest()
    if TAG_RE.match(up) or up.startswith("ui-v"):
        up = fetch_release(up)
    up_assets = os.path.join(up, "assets")
    new_app = one(up_assets, "app-", ".js")
    new_css = one(up_assets, "index-", ".css")
    new_editor = one(up_assets, "editor-", ".js")

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = os.path.join(APP_GROUP, "web-backup-" + stamp)
    os.makedirs(os.path.join(backup, "assets"), exist_ok=True)
    for name in os.listdir(os.path.join(WEB, "assets")):
        if name.startswith(("app-", "index-")) or name.startswith("editor-"):
            shutil.copy2(os.path.join(WEB, "assets", name), os.path.join(backup, "assets", name))
    for name in ["index.html", "version.json", "build-meta.json"]:
        shutil.copy2(os.path.join(WEB, name), os.path.join(backup, name))
    print("备份 ->", backup)

    # ---- 1. 打包资源 ----
    for name in os.listdir(os.path.join(WEB, "assets")):
        if name.startswith(("app-", "index-")) and (name.endswith(".js") or name.endswith(".css")):
            os.remove(os.path.join(WEB, "assets", name))
    shutil.copy2(os.path.join(up_assets, new_app), os.path.join(WEB, "assets", new_app))
    shutil.copy2(os.path.join(up_assets, new_css), os.path.join(WEB, "assets", new_css))

    spec = json.load(open(SPEC, encoding="utf-8"))
    app_path = os.path.join(WEB, "assets", new_app)
    text = read(app_path)
    for i, patch in enumerate(spec["app"], 1):
        old, new = patch["old"][0], patch["new"][0]
        if text.count(new) and not text.count(old):
            print("  补丁 %d 已存在，跳过" % i)
            continue
        if text.count(old) != 1:
            raise SystemExit("补丁 %d 锚点命中 %d 次（应为 1）：%s" % (i, text.count(old), old[:80]))
        text = text.replace(old, new)
        print("  补丁 %d 已重放" % i)
    write(app_path, text)

    # ---- 2. editor：仅在上游内容变化时重打 ----
    local_editor = os.path.join(WEB, "assets", new_editor)
    up_editor = os.path.join(up_assets, new_editor)
    ed = read(up_editor)
    ins = spec["editor"][0]
    anchor = '  if (type === "sing-box") {\n'
    marker = "Surge 配置文件应包含区段头"
    if marker not in ed:
        if ed.count(anchor) != 1:
            raise SystemExit("editor 锚点命中 %d 次" % ed.count(anchor))
        ed = ed.replace(anchor, "\n".join(ins["new"]) + "\n" + anchor)
    before = sha(local_editor) if os.path.exists(local_editor) else ""
    write(local_editor, ed)
    state = "未变" if before == sha(local_editor) else "已更新"
    print("  editor %s（已重放 Surge 校验补丁）" % state)
    for name in sorted(os.listdir(os.path.join(WEB, "assets"))):
        if name.startswith("editor-") and name != new_editor:
            os.remove(os.path.join(WEB, "assets", name))
            print("  移除旧 editor", name)

    # ---- 3. 其余静态资源 ----
    for sub in ["fonts", "img", "help", "custom"]:
        src = os.path.join(up_assets, sub)
        dst = os.path.join(WEB, "assets", sub)
        if not os.path.isdir(src):
            src = os.path.join(up, sub)
            dst = os.path.join(WEB, sub)
        if not os.path.isdir(src):
            continue
        for name in sorted(os.listdir(src)):
            sp = os.path.join(src, name)
            if not os.path.isfile(sp):
                continue
            dp = os.path.join(dst, name)
            if name == "settings.json" and os.path.exists(dp):
                continue  # 本地用户界面设置不覆盖
            os.makedirs(dst, exist_ok=True)
            shutil.copy2(sp, dp)
    shutil.copy2(os.path.join(up, "build-meta.json"), os.path.join(WEB, "build-meta.json"))

    # ---- 4. version.json ----
    ver = json.loads(read(os.path.join(up, "version.json")))
    ver["backendVersion"] = "FJMOS"
    # releaseTag 跟随上游发行线（fjn01- / fjn8c- …），不再硬编码前缀
    ver.setdefault("releaseTag", "ui-v%s" % ver["uiVersion"])
    write(os.path.join(WEB, "version.json"), json.dumps(ver, ensure_ascii=False, indent=2) + "\n")

    # ---- 5. index.html ----
    html = read(os.path.join(up, "index.html"))
    css_line = '  <link rel="stylesheet" crossorigin href="/ui/assets/%s">\n' % new_css
    if html.count(css_line) != 1:
        raise SystemExit("index.html 中未能唯一定位 css link")
    html = html.replace(css_line, css_line + LIVEPULSE)
    if html.count(DOCK_ANCHOR) != 1:
        raise SystemExit("index.html 中未能唯一定位 top-actions-dock")
    html = html.replace(DOCK_ANCHOR, DOCK_ANCHOR + ADHUNTER)
    if len(BRAND_RE.findall(html)) != 1:
        raise SystemExit("index.html 中未能唯一匹配品牌版本徽标（%d 处）" % len(BRAND_RE.findall(html)))
    html = BRAND_RE.sub(BRAND_NEW, html)
    write(os.path.join(WEB, "index.html"), html)

    # ---- 6. 收尾自检：任何一项不符都不算同步成功 ----
    problems = []
    assets = os.path.join(WEB, "assets")
    apps = sorted(n for n in os.listdir(assets) if n.startswith("app-") and n.endswith(".js"))
    csss = sorted(n for n in os.listdir(assets) if n.startswith("index-") and n.endswith(".css"))
    if apps != [new_app]:
        problems.append("assets 内 app-*.js 不唯一：%s" % apps)
    if csss != [new_css]:
        problems.append("assets 内 index-*.css 不唯一：%s" % csss)
    if not os.path.exists(os.path.join(assets, new_editor)):
        problems.append("缺少 editor：%s" % new_editor)
    patched = read(os.path.join(assets, new_app))
    for i, patch in enumerate(spec["app"], 1):
        if patch["new"][0] not in patched:
            problems.append("app 补丁 %d 未命中" % i)
    if "Surge 配置文件应包含区段头" not in read(local_editor):
        problems.append("editor Surge 校验补丁未命中")
    for needle in ("livepulse.js", "surge-workbench.js", "ad-hunter.html", 'data-backend-version="FJMOS"'):
        if needle not in html:
            problems.append("index.html 缺少本地定制：%s" % needle)
    if new_app not in html or new_css not in html:
        problems.append("index.html 未引用新打包文件")
    if problems:
        raise SystemExit("同步自检失败：\n  - " + "\n  - ".join(problems))

    print("完成：%s / %s（自检通过）" % (new_app, new_css))
    for rel in ["assets/" + new_app, "assets/" + new_css, "assets/" + new_editor, "index.html", "version.json"]:
        print("  %s  %s" % (sha(os.path.join(WEB, rel))[:16], rel))


if __name__ == "__main__":
    main()
