#!/usr/bin/env python3
import json
import re
import urllib.request

PROMPT = (
    "先输出一行进度：当前进度：15%|已完成：确认上游稳定版 v4.0.0 已发布|下一步：拉取镜像；"
    "然后用 shell 工具执行 docker pull x"
)
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "shell",
            "description": "执行本机 shell 命令",
            "parameters": {
                "type": "object",
                "properties": {"action": {"type": "string"}, "command": {"type": "string"}},
                "required": ["action", "command"],
            },
        },
    }
]

LEAK_RES = [
    ("tool_tag", re.compile(r"<\s*/?\s*tool", re.I)),
    ("tool_dash", re.compile(r"tool[-_.:]\s*calls?", re.I)),
    ("function_tag", re.compile(r"<\s*/?\s*function", re.I)),
    ("invoke_tag", re.compile(r"<\s*/?\s*invoke", re.I)),
    ("parameter_tag", re.compile(r"<\s*/?\s*parameter", re.I)),
    ("dsml", re.compile(r"DSML", re.I)),
    ("cn_tool", re.compile(r"调用工具")),
    ("special_token", re.compile(r"<[|｜]")),
]

def post(url, body, timeout=240):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")

def collect(stream_text):
    """抽出所有 content 增量，用于泄漏判定（tool_calls 字段是合法通道，不算泄漏）"""
    content = []
    tool_calls = 0
    stripped = stream_text.strip()
    if stripped.startswith("{"):
        try:
            obj = json.loads(stripped)
            for ch in obj.get("choices") or []:
                msg = ch.get("message") or {}
                if isinstance(msg.get("content"), str) and msg["content"]:
                    content.append(msg["content"])
                if msg.get("tool_calls"):
                    tool_calls += len(msg["tool_calls"])
            return "".join(content), tool_calls
        except Exception:
            pass
    for line in stream_text.splitlines():
        if not line.startswith("data: "):
            continue
        raw = line[6:].strip()
        if raw == "[DONE]":
            continue
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        for ch in obj.get("choices") or []:
            d = ch.get("delta") or {}
            if isinstance(d.get("content"), str):
                content.append(d["content"])
            if d.get("tool_calls"):
                tool_calls += len(d["tool_calls"])
            msg = ch.get("message") or {}
            if isinstance(msg.get("content"), str) and msg["content"]:
                content.append(msg["content"])
            if msg.get("tool_calls"):
                tool_calls += len(msg["tool_calls"])
    return "".join(content), tool_calls

report = {}

# 1) 5195 真流式
body = {"model": "hanshuang-cpa", "stream": True, "messages": [{"role": "user", "content": PROMPT}], "tools": TOOLS}
try:
    raw = post("http://127.0.0.1:5195/v1/chat/completions", body)
    text, tc = collect(raw)
    hits = [name for name, rx in LEAK_RES if rx.search(text)]
    report["5195_stream"] = {
        "ok": True,
        "content": text,
        "tool_calls": tc,
        "leaks": hits,
        "sse_has_done": "data: [DONE]" in raw,
    }
except Exception as e:
    report["5195_stream"] = {"ok": False, "error": str(e)}

# 2) 5190 非流式
body = {"model": "hanshuang-cpa", "stream": False, "messages": [{"role": "user", "content": PROMPT}], "tools": TOOLS}
try:
    raw = post("http://127.0.0.1:5190/v1/chat/completions", body)
    text, tc = collect(raw)
    hits = [name for name, rx in LEAK_RES if rx.search(text)]
    report["5190_nonstream"] = {"ok": True, "content": text, "tool_calls": tc, "leaks": hits, "raw": raw[:800]}
except Exception as e:
    report["5190_nonstream"] = {"ok": False, "error": str(e)}

# 3) 5190 流式（HttpServer 协议级 SSE）
body = {"model": "hanshuang-cpa", "stream": True, "messages": [{"role": "user", "content": PROMPT}], "tools": TOOLS}
try:
    raw = post("http://127.0.0.1:5190/v1/chat/completions", body)
    text, tc = collect(raw)
    hits = [name for name, rx in LEAK_RES if rx.search(text)]
    report["5190_stream"] = {"ok": True, "content": text, "tool_calls": tc, "leaks": hits}
except Exception as e:
    report["5190_stream"] = {"ok": False, "error": str(e)}

passed = all(
    r.get("ok") and not r.get("leaks") for r in report.values()
)
print(json.dumps({"passed": passed, "report": report}, ensure_ascii=False, indent=2))
