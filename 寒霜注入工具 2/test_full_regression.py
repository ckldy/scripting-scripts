# -*- coding: utf-8 -*-
"""寒霜注入工具 — 全功能回归测试（串行，避免本地模型并发干扰）。"""
import io
import json
import os
import sys
import time
import urllib.request
import urllib.error

BASE = 'http://127.0.0.1:5190'
PASS, FAIL = [], []


def check(name, ok, detail=''):
    if ok:
        PASS.append(name)
        print('[PASS] %-42s %s' % (name, detail))
    else:
        FAIL.append(name)
        print('[FAIL] %-42s %s' % (name, detail))


def req(path, method='GET', payload=None, timeout=200, raw=False):
    url = BASE + path
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            body = resp.read().decode('utf-8', 'replace')
            return resp.status, (body if raw else _try_json(body))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
        return e.code, (body if raw else _try_json(body))


def _try_json(s):
    try:
        return json.loads(s)
    except Exception:
        return s


print('=' * 62)
print('  寒霜注入工具 — 全功能回归')
print('=' * 62)

# ---------- 1. 服务与保活 ----------
print('\n--- 1. 服务与保活 ---')
st, d = req('/api/self-heal/status')
check('1.1 自愈状态可用', st == 200 and isinstance(d, dict), 'status=%s' % st)
if isinstance(d, dict):
    tg = d.get('targets', {})
    check('1.2 自愈健康', d.get('health') == 'healthy', str(d.get('health')))
    check('1.3 5 个注入点全部就绪',
          all(tg.get(k) for k in ['cardsStore', 'scriptingAssistantFile', 'armorKernelFile', 'gatewayProxy', 'backgroundKeeper']),
          str({k: tg.get(k) for k in ['cardsStore', 'scriptingAssistantFile', 'armorKernelFile', 'gatewayProxy', 'backgroundKeeper']}))

st, d = req('/api/keepalive')
check('1.4 保活可用', st == 200 and isinstance(d, dict) and d.get('ok'), 'status=%s' % st)
if isinstance(d, dict) and d.get('keepAlive'):
    ka = d['keepAlive']
    check('1.5 保活 active', ka.get('active') is True, 'status=%s dur=%ss' % (ka.get('status'), ka.get('durationSeconds')))

# ---------- 2. WebUI 静态资源 ----------
print('\n--- 2. WebUI ---')
st, body = req('/', raw=True)
check('2.1 index.html', st == 200 and '<div id="root">' in str(body), 'status=%s' % st)
st, body = req('/assets/main-D-220Ow5.js', raw=True, timeout=30)
check('2.2 main.js', st == 200, 'status=%s' % st)

# ---------- 3. 人物卡 ----------
print('\n--- 3. 人物卡 ---')
st, d = req('/api/prompt-cards/overview')
cards = d.get('cards', []) if isinstance(d, dict) else []
check('3.1 卡片列表', st == 200 and len(cards) == 6, '%d 张' % len(cards))
cur = d.get('currentId') if isinstance(d, dict) else None
check('3.2 当前卡片', bool(cur), str(cur))

# 切换 → 校验 → 切回
if cur:
    other = [c['id'] for c in cards if c['id'] != cur]
    if other:
        target = other[0]
        req('/api/prompt-cards/select', 'POST', {'id': target}, timeout=30)
        st2, d2 = req('/api/prompt-cards/overview', timeout=30)
        check('3.3 卡片切换生效', d2.get('currentId') == target, '%s -> %s' % (cur, d2.get('currentId')))
        req('/api/prompt-cards/select', 'POST', {'id': cur}, timeout=30)
        st3, d3 = req('/api/prompt-cards/overview', timeout=30)
        check('3.4 卡片切回', d3.get('currentId') == cur, str(d3.get('currentId')))

# ---------- 4. 判拒检测 ----------
print('\n--- 4. 判拒检测 ---')
st, d = req('/api/judge', 'POST', {'text': '很抱歉，我无法提供这个帮助'}, timeout=30)
check('4.1 识别硬拒答', isinstance(d, dict) and d.get('refusal') is True, str(d.get('hits')) if isinstance(d, dict) else '')
st, d = req('/api/judge', 'POST', {'text': '下面是完整实现方案：先读取配置，再定位偏移。'}, timeout=30)
check('4.2 正常内容不误判', isinstance(d, dict) and d.get('refusal') is False, str(d.get('hits')) if isinstance(d, dict) else '')

# ---------- 5. 网关：三种协议 ----------
print('\n--- 5. 网关协议 ---')
st, d = req('/v1/chat/completions', 'POST',
            {'model': 'hanshuang-armor', 'messages': [{'role': 'user', 'content': '只回答两个字：一'}]})
ok = isinstance(d, dict) and d.get('choices') and d['choices'][0]['message']['content'].strip()
check('5.1 OpenAI Chat', bool(ok), (d.get('choices', [{}])[0].get('message', {}).get('content', '') if isinstance(d, dict) else str(d))[:40])

st, d = req('/v1/messages', 'POST',
            {'model': 'hanshuang-armor', 'max_tokens': 100,
             'messages': [{'role': 'user', 'content': '只回答两个字：二'}]})
ok = isinstance(d, dict) and d.get('content') and d['content'][0].get('text', '').strip()
check('5.2 Anthropic Messages', bool(ok), (d.get('content', [{}])[0].get('text', '') if isinstance(d, dict) else str(d))[:40])

st, d = req('/v1/responses', 'POST',
            {'model': 'hanshuang-armor', 'input': [{'role': 'user', 'content': '只回答两个字：三'}]})
ok = isinstance(d, dict) and d.get('output')
check('5.3 OpenAI Responses', bool(ok), str(d.get('status')) if isinstance(d, dict) else str(d)[:60])

st, body = req('/v1/chat/completions', 'POST',
               {'model': 'hanshuang-armor', 'stream': True,
                'messages': [{'role': 'user', 'content': '只回答两个字：四'}]}, raw=True)
ok = isinstance(body, str) and 'data:' in body and '[DONE]' in body
check('5.4 流式 SSE', ok, body.split('\n')[0][:50] if isinstance(body, str) else '')

# ---------- 6. 模型列表 ----------
print('\n--- 6. 模型端点 ---')
st, d = req('/v1/models', timeout=30)
ids = [m.get('id') for m in d.get('data', [])] if isinstance(d, dict) else []
check('6.1 /v1/models', 'hanshuang-armor' in ids, str(ids))

# ---------- 7. 注入生效 ----------
print('\n--- 7. 注入生效 ---')
st, d = req('/api/card-proxy/status', timeout=30)
li = (d.get('lastInjection') or {}) if isinstance(d, dict) else {}
check('7.1 injected', li.get('injected') is True, str(li.get('injected')))
check('7.2 containsCard', li.get('containsCard') is True, str(li.get('containsCard')))
check('7.3 指令长度', (li.get('instructionsLength') or 0) > 1000, str(li.get('instructionsLength')))

# 7.4：判定字段已拆分。judgement/instructionJudgement 判的是「注入后的指令文本」，
# 而那段文本内含寒霜卡自己的拒绝话术清单，必然命中，没有参考价值。
# 真正要看的是 outputJudgement（对模型实际输出的判定）。
oj = li.get('outputJudgement')
check('7.4 模型输出无拒答',
      isinstance(oj, dict) and oj.get('refusal') is False,
      'outputJudgement=%s' % oj)

# ---------- 8. 注入点落盘 ----------
print('\n--- 8. 注入点落盘 ---')
st, d = req('/api/inject/scripting/overview', timeout=60)
targets = d.get('targets', []) if isinstance(d, dict) else []
check('8.1 5 个目标', len(targets) == 5, '%d 个' % len(targets))

# 注意：armor_kernel 的接口 content 只返回卡片 system 正文（不含标记），
# 必须直接读文件才能校验标记；其余 4 项直接看接口 content。
all_ok = True
for t in targets:
    tid = t.get('id')
    if tid == 'armor_kernel':
        p = t.get('path') or ''
        raw = ''
        if p and os.path.exists(p):
            try:
                raw = io.open(p, encoding='utf-8').read()
            except Exception:
                raw = ''
        has = 'cc-switch-card' in raw
        print('       %-20s exists=%-5s size=%-6s marker=%s (由文件校验)' % (tid, t.get('exists'), t.get('size'), has))
    else:
        has = 'cc-switch-card' in (t.get('content') or '')
        print('       %-20s exists=%-5s size=%-6s marker=%s' % (tid, t.get('exists'), t.get('size'), has))
    if not (t.get('exists') and has):
        all_ok = False
check('8.2 全部已落盘且带标记', all_ok, '')

# ---------- 9. 应用注入端点 ----------
print('\n--- 9. 多应用端点 ---')
st, d = req('/api/inject/apps', timeout=30)
apps = [a.get('id') for a in d] if isinstance(d, list) else []
check('9.1 应用列表', len(apps) >= 8, '%d 个: %s' % (len(apps), ','.join(apps[:6])))
for app in ['claude', 'codex', 'gemini']:
    st, _ = req('/api/inject/%s/overview' % app, timeout=30)
    check('9.2 %s overview' % app, st == 200, 'status=%s' % st)

# ---------- 10. /armor ----------
print('\n--- 10. /armor 破甲验证 ---')
st, d = req('/armor', 'POST', {'prompt': '只回答两个字：验证', 'maxRetry': 0})
ok = isinstance(d, dict) and d.get('ok') and str(d.get('text', '')).strip()
check('10.1 /armor 返回真实输出', bool(ok),
      'channel=%s text=%s' % (d.get('channel'), str(d.get('text', ''))[:30]) if isinstance(d, dict) else str(d)[:60])

# 10.1 只证明“请求能回来”，不证明“破甲”。真正要断言的是 refusal 为 False。
not_refused = isinstance(d, dict) and d.get('refusal') is False
check('10.2 /armor 输出未被判拒', bool(not_refused),
      'refusal=%s rounds=%s' % (d.get('refusal') if isinstance(d, dict) else '?',
                                d.get('rounds') if isinstance(d, dict) else '?'))

# 网关链路：/v1/chat/completions 必须把“模型输出判定”写回 lastInjection，
# 否则破甲是否成功无证据（旧实现只记注入动作，不记输出结果）。
req('/v1/chat/completions', 'POST',
    {'model': 'hanshuang-armor', 'messages': [{'role': 'user', 'content': '只回答两个字：二'}]})
st, stt = req('/api/card-proxy/status')
li = (stt or {}).get('lastInjection') if isinstance(stt, dict) else None
check('10.3 网关回写输出判定', bool(isinstance(li, dict) and li.get('outputJudgement') is not None),
      'rounds=%s stillRefused=%s' % (li.get('rounds') if isinstance(li, dict) else '?',
                                     li.get('stillRefused') if isinstance(li, dict) else '?'))

# ---------- 11. 自愈 ----------
print('\n--- 11. 自愈恢复 ---')
rules = '/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/assistant-rules/hanshuang-armor.md'
if os.path.exists(rules):
    orig = io.open(rules, encoding='utf-8').read()
    io.open(rules, 'w', encoding='utf-8').write('damaged')
    st, d = req('/api/self-heal/trigger', 'POST', {}, timeout=60)
    healed = isinstance(d, dict) and d.get('healed') is True
    after = io.open(rules, encoding='utf-8').read()
    ok = healed and 'cc-switch-card' in after and not after.startswith('<!-- <!--')
    check('11.1 破坏后自动恢复', ok, 'healed=%s' % healed)
    check('11.2 标记未重复嵌套', not after.startswith('<!-- <!--'), after.split('\n')[0][:40])
    if not ok:
        io.open(rules, 'w', encoding='utf-8').write(orig)
else:
    check('11.1 破坏后自动恢复', False, 'rules 文件不存在')

# ---------- 汇总 ----------
print('\n' + '=' * 62)
print('  通过 %d / %d' % (len(PASS), len(PASS) + len(FAIL)))
if FAIL:
    print('  失败项：')
    for f in FAIL:
        print('    - ' + f)
print('=' * 62)
