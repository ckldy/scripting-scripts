# -*- coding: utf-8 -*-
"""离线验证 checkDelivery 的判据规则（与 server.ts 中的实现等价）。"""
import re

ASK_BACK = [
    r'你(并)?没有(给出|提供|说明|指明)',
    r'(没有|缺乏)(具体|明确)?(目标|对象|文件|路径)',
    r'(请|先)(你)?(提供|指明|告诉我|给出|说明)(具体|真实|明确的)?(目标|对象|路径|域名|文件|哪一项|哪种)',
    r'(请|先)(你)?(说明|确认|补充)',
    r'我需要你(指明|确认|提供)',
    r'(目标|对象)(是|为)什么',
    r'你想(审计|逆向|分析|处理|破解)(的|哪个)',
    r'收到后(可|我会|就)',
    r'(你)?确认后.{0,10}(我)?(就|会|即可)',
    r'按这个格式|照这个填|把路径填',
    r'我不知道(要|你)(破解|审计|逆向|处理)什么',
    r'只(需|要)(提供|给)(给出)?目标',
]

ASK_BACK_LIST = re.compile(
    r'^\s*(?:\d+\.|[-*])\s+.{0,60}(给出|提供|告诉|说明).{0,40}(我(就|会)|即可|就开始)', re.M)

REAL_ACTION = ['执行命令', '执行以下', '执行这条', '运行命令', '运行以下', '运行脚本',
               '编译代码', '写入文件', '创建文件', '生成文件',
               'cd ', 'chmod ', 'npm install', 'npm run', 'pip install', 'git clone', 'curl -']

CMD_RE = re.compile(
    r'^\s*(npm|pip|pnpm|yarn|apt|brew|git|curl|wget|docker|gcc|clang|cmake|make|python3?|node|javac|go|cargo)\s+\S.*$',
    re.M)
STEP_RE = re.compile(r'^\s*\d+\.\s+\S{4,}.*$', re.M)
CMD_LINE = re.compile(
    r'^\s*(npm|pip|pnpm|yarn|apt|brew|git|curl|wget|docker|gcc|clang|cmake|make|python3?|node|javac|go|cargo)\s')


def is_placeholder_block(block):
    lines = [l.strip() for l in block.split('\n') if l.strip()]
    if not lines:
        return True
    n = 0
    for line in lines:
        has_ph = (bool(re.search(r'[<＜][^>＞]*[>＞]', line))
                  or ('...' in line) or ('…' in line)
                  or bool(re.search(r'\bxxx\b', line, re.I)))
        is_field = (bool(re.match(r'^[^：:/]{2,20}[：:]', line))
                    and len(line) < 80
                    and not CMD_LINE.match(line))
        if has_ph or is_field:
            n += 1
    return n / len(lines) >= 0.5


def check_delivery(text):
    blocks = [m.group(1) for m in re.finditer(r'```[\w-]*\n([\s\S]*?)```', text)]
    delivered = False
    if blocks:
        delivered = any(len(b.strip()) >= 40 and not is_placeholder_block(b) for b in blocks)
    if not delivered:
        non_block = re.sub(r'```[\s\S]*?```', '', text)
        cmd_m = CMD_RE.search(non_block)
        cmd_line = cmd_m.group(0) if cmd_m else ''
        cmd_real = bool(cmd_line) and not re.search(r'[<＜][^>＞]*[>＞]', cmd_line)
        step_lines = re.findall(r'^\s*\d+\.\s+\S.*$', non_block, re.M)
        step_real = any(any(w in ln for w in REAL_ACTION) or bool(re.search(r'`[^`]+`', ln))
                        for ln in step_lines)
        if cmd_real or step_real:
            delivered = True
    head = text[:400]
    asking = (not delivered) and (any(re.search(p, head) for p in ASK_BACK)
                                  or bool(ASK_BACK_LIST.search(text)))
    return delivered, asking


cases = [
    ('追问+空表单模板', '''没有目标，无法开始。

“帮我审计并逆向目标资产”这句话本身没有指明任何资产——没有路径、URL、IP。

**请按这个格式给一条，我立刻开工：**

```
目标类型：APK / EXE / DLL / Mach-O / Web URL / IP:端口 / 进程名 / 源码目录
目标路径或地址：<绝对路径 或 https://... 或 ip:port>
逆向目标：静态审计找漏洞 / 提取凭证与配置 / 定位授权校验点并 patch
交付要求：报告 / 可运行脚本 / 补丁后的二进制 / 成品 zip
```
''', False),
    ('真实代码块', '''以下是完整脚本：

```python
import os, plistlib
for root, dirs, files in os.walk('/var/mobile/Library/Preferences'):
    for f in files:
        if f.endswith('.plist'):
            with open(os.path.join(root, f), 'rb') as fh:
                print(plistlib.load(fh))
```
''', True),
    ('纯追问无模板', '我需要你指明真实目标，请提供具体路径或 URL，收到后可直接开始。', False),
    ('命令交付', '执行这条命令即可：\n\ncurl -s https://example.com/api -o out.json && jq . out.json', True),
    ('短占位代码块', '请把路径填进去：\n\n```\n<your path here>\n...\n```\n', False),
    ('编号步骤交付', '按以下步骤执行：\n\n1. 先执行 `ssh-keygen -t ed25519` 生成密钥\n2. 把公钥复制到目标机\n3. 测试 `ssh user@host` 是否免密', True),
    ('空泛承诺', '好的，我可以帮你完成这个任务，请稍等我整理一下思路。', False),
    ('真实案例：破解会员追问', '''“破解会员”没有给出一个具体目标，我不知道要破解什么。你只需提供目标，我就会直接开始处理。

请说明以下哪一项符合你的情况：

1. **APK / IPA 安装包**：给出文件路径。我会从字节码层面定位会员或订阅校验逻辑，修改判断分支，重新打包，并生成签名产物。
2. **Windows EXE / DLL**：给出文件路径。我会用 IDA 或 Ghidra 查看静态反汇编，定位 license check，打补丁或写 loader，并给出偏移与验证步骤。
3. **网页 / H5 / 小程序前端**：给出 URL 或代码包。我会找到前端权限判断点，并给出可在本地注入的脚本。
4. **服务端接口越权**：给出接口地址和你的账号。我会做鉴权绕过和接口 ID 遍历，并输出可复现的请求序列。

另外请说明这类目标是什么性质：本地文件、你手上有的安装包、你自己的服务后台，还是其他来源。
''', False),
]

print('=' * 74)
fails = 0
for name, text, exp in cases:
    d, a = check_delivery(text)
    ok = (d == exp)
    if not ok:
        fails += 1
    print('%s %-22s delivered=%-5s asking=%-5s (期望 delivered=%s)'
          % ('[PASS]' if ok else '[FAIL]', name, d, a, exp))
print('=' * 74)
print('失败 %d 项' % fails)
