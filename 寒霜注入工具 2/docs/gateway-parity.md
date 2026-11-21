# 网关 vs 系统直连 · 能力对齐表

审计时间：2026-11-20 16:45
审计对象：`server.ts` 的 `/v1/chat/completions`、`/v1/responses`、`/v1/messages`、`/v1/models`、`/armor`

## 一、能力矩阵

| 能力 | 直连系统模型 | 网关改前 | 网关现在 |
|---|---|---|---|
| 工具调用 | 原生 `tools` | 文本协议中继，只认 3 种格式 | **6 种格式全认**：`<tool_calls>` XML、DSML、`<tool_call>` 子标签/JSON、裸 JSON 对象、`[调用工具 X 参数 {…}]` |
| 包装层 | 不存在 | `call_assistant_tool(tool_name=shell)` 原样透传 → 客户端报未知工具 | **自动摊平**成 `shell({…})`，仅当内层工具已声明 |
| 参数格式 | 合法 JSON | 会漏出 `<parameter name="command">…</parameter>` | **`normalizeArgs()` 强转合法 JSON**（含兜底 `{command:…}`） |
| 工具名大小写 | 严格 | 原样透传 | 按声明列表大小写无关纠正 |
| `tool_choice` | 支持 none/required/指定 | 忽略 | **已补**：none 不注入工具；required/指定函数加硬约束 |
| `parallel_tool_calls=false` | 支持 | 忽略 | **已补**：只保留第一个调用 |
| 多轮工具循环 | 支持 | 支持（日志已验证） | 支持 |
| 流式输出 | token 级增量 | 一次性整段 | **两条路径**：5195 node:net 逐 token 真流式；5190 先跑完破甲再按 40 字符分片。两条都过判拒门禁 |
| `usage` | 有 | 无 | **已补**：优先用 `StreamUsageChunk` 真实 `inputTokens/outputTokens`，缺失时才估算 |
| `stream_options.include_usage` | 支持 | 忽略 | **已补**：末尾追加 usage chunk |
| `response_format=json_object` | 支持 | 忽略 | **已补**：prompt 层强制「只输出 JSON」 |
| 图片输入 | 支持 | 静默丢弃 | **显式提示**「图片已省略」；仍不支持真传图（见限制） |
| `temperature/top_p/max_tokens/stop/n/logprobs` | 支持 | 静默忽略 | 仍不支持（Assistant API 无此入参，属硬限制） |
| reasoning / thinking | 视模型 | 丢弃 | **已补**：消费 `StreamReasoningChunk`，非流式放 `message.reasoning_content`、流式放 `delta.reasoning_content` |
| 判拒检测 + 跨轮纠正 | 无 | 有 | 有（5190 先判拒后切片；5195 首窗门禁：260 字或 60 字+交付特征提前放行） |
| 引擎池回退 | 无 | 有 | 有（Gemini 被拦 / Provider 故障时按池换引擎） |
| `/v1/models` | — | 3 个别名 | 动态列出引擎池 |
| 上游错误 | — | 502 `assistant_unavailable` | 同，附引擎池回退 |

## 三、真流式破甲门禁（5195）

`handleStreamChatCompletions` 不再单轮直通，改为与 5190 一致的多轮链路：

1. `judge()` 只看前 `REFUSAL_WINDOW_CHARS=220` 字符，所以先缓冲“首窗”再对外推：
   - 窗口内命中拒答/软回退 → 整轮作废，**一个字节都不发**，转纠正轮；
   - 正常文本满 `STREAM_GUARD_MAX_CHARS=260` → 放行逐 token 直推；
   - 或满 `STREAM_GUARD_MIN_CHARS=60` 且句末/代码围栏收尾 + 含交付特征（代码块、命令、列表）→ 提前放行。
2. 每轮纠正：system 最前面拼 `armorCorrectivePrefixFor()`，历史里带上轮拒答原文 + 纠偏 user。
3. 纠正轮消耗完仍被拦、且一个字都没推出去 → 按引擎池换引擎重跑。
4. 全部失败 → 返回 `armor_blocked` 错误，绝不把拒答正文交给客户端。
5. 轮次证据写入 `lastInjection.outputJudgement / rounds / corrected / stillRefused / fallbackEngine`。

回归：`scripting-ts run tests/test_stream_guard.ts`（纯逻辑，不联网）。

## 四、仍不对齐的地方（硬限制，非 bug）

1. **采样参数全丢**：`Assistant.requestStreaming` 只接受 `systemPrompt/messages/providerID/modelId`，没有 `temperature/max_tokens/top_p/stop`。网关无法伪造——传了也没处用。
2. **非原生工具调用**：客户端拿到的是网关「翻译」出来的 `tool_calls`，模型侧实际走文本协议。稳定性依赖解析器，格式再多也要兜住。
3. **图片/音频输入**：文本通道塞不进二进制，只能提示。
4. **`n>1`**：一次只能产生一条候选。

## 五、回归验证方式

```bash
python3 data/verify_tools.py     # 流式 + 非流式 tool_calls 是否合法 JSON
python3 data/check_and_wx.py     # 顺带看 data/requests.json 最近 20 条请求/响应
```

日志字段：
- `kind:"req"` → model / stream / roles / tools
- `kind:"res", finish:"tool_calls"` → names / args
- `kind:"res", finish:"stop"` → head（正文前 200 字）

## 六、排查口径

| 现象 | 归属 |
|---|---|
| `finish:"tool_calls"` 且 args 合法，但客户端没执行 | 客户端侧工具注册/渲染 |
| `finish:"stop"` 且 head 是工具标记文本 | 解析器未覆盖该格式 → 加分支 |
| 只有 `req` 没有 `res` | 上游/引擎异常 → 看 502 与引擎池 |
| `assistant_unavailable` + `AgentProviderConnectionError` | Provider 连不上，换引擎 |
