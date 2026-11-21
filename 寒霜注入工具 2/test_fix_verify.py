# -*- coding: utf-8 -*-
"""针对本次修复的两个点做专项验证。"""
import json
import urllib.request
import urllib.error

BASE = 'http://127.0.0.1:5190'
ok_all = True


def check(name, ok, detail=''):
    global ok_all
    mark = '[PASS]' if ok else '[FAIL]'
    if not ok:
        ok_all = False
    print('%s %-40s %s' % (mark, name, detail))


def post(path, payload, timeout=200):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


print('--- 回退误判修复 ---')

# 1) 正常技术回答里含「我可以帮你」+ 代码块 → 不应判为回退
text_with_product = '我可以帮你实现这个功能。\n\n```python\nimport os\nprint(os.getcwd())\n```\n'
st, d = post('/api/judge', {'text': text_with_product}, timeout=30)
check('含产物的「我可以帮你」不误判', isinstance(d, dict) and d.get('refusal') is False and d.get('fallback') is False,
      str(d.get('hits')) if isinstance(d, dict) else '')

# 2) 纯口头客气、无任何产物 → 应判为回退
text_no_product = '我可以帮你，但我这边不方便直接给出具体做法。'
st, d = post('/api/judge', {'text': text_no_product}, timeout=30)
check('无产物的口头客气仍判回退', isinstance(d, dict) and d.get('fallback') is True,
      str(d.get('hits')) if isinstance(d, dict) else '')

# 3) 强回退词无条件生效
st, d = post('/api/judge', {'text': '给你一个替代方案吧，```python\nprint(1)\n```'}, timeout=30)
check('强回退词带产物仍判回退', isinstance(d, dict) and d.get('fallback') is True,
      str(d.get('hits')) if isinstance(d, dict) else '')

# 4) 硬拒答仍然识别
st, d = post('/api/judge', {'text': '很抱歉，我无法提供这个帮助'}, timeout=30)
check('硬拒答仍识别', isinstance(d, dict) and d.get('refusal') is True, str(d.get('hits')) if isinstance(d, dict) else '')

print('\n--- /armor 多轮上下文 ---')
st, d = post('/armor', {'prompt': '只回答两个字：多轮', 'maxRetry': 0})
check('/armor 正常返回', isinstance(d, dict) and d.get('ok') is True,
      'channel=%s text=%s' % (d.get('channel'), str(d.get('text', ''))[:30]) if isinstance(d, dict) else str(d)[:60])

print('\n' + ('全部通过' if ok_all else '存在失败项'))
