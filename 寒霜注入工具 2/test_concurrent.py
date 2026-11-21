# -*- coding: utf-8 -*-
"""并发测试：同时发 N 个请求，验证串行队列是否让全部成功。"""
import json
import threading
import time
import urllib.request

URL = 'http://127.0.0.1:5190/v1/chat/completions'
N = 4
results = [None] * N


def worker(i):
    body = json.dumps({
        'model': 'hanshuang-armor',
        'messages': [{'role': 'user', 'content': f'只回答两个字：并发{i+1}'}],
    }).encode()
    req = urllib.request.Request(URL, data=body, headers={'Content-Type': 'application/json'})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            d = json.loads(r.read().decode())
            txt = d.get('choices', [{}])[0].get('message', {}).get('content', '')
            results[i] = ('OK', txt, round(time.time() - t0, 1))
    except Exception as e:
        results[i] = ('ERR', str(e)[:100], round(time.time() - t0, 1))


threads = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
t_start = time.time()
for t in threads:
    t.start()
for t in threads:
    t.join()

print('total wall time: %.1fs' % (time.time() - t_start))
for i, r in enumerate(results):
    print('#%d %-4s %-30s %ss' % (i + 1, r[0], r[1], r[2]))
