# Experience Live Test

经验提取流水线（Phase 0-2a）的端到端 live test 框架。通过真实 LLM 对话生成 transcript，然后调用 `extractCandidates()` 和 `runDistill()` 验证完整链路。

## 消息链路

```
预设对话问题 → 真实 LLM 对话 → Transcript JSONL → extractCandidates() → Candidates Store → runDistill() → Distilled Records
```

## 前置条件

1. `.env.dev` 配置了 `ENCLAWS_DB_URL`（PostgreSQL 或 SQLite）
2. 数据库 `tenant_models` 表中至少有一条 `is_active=true` 的记录，且 API key 有效
3. `~/.enclaws/workspace/` 存在（Gateway 运行过一次即可）

## 运行

```bash
# 运行全部场景
ENCLAWS_LIVE_TEST=1 pnpm vitest run --config vitest.live.config.ts test/experience-live/experience.live.test.ts

# 运行单元测试（不需要 DB 和 API key）
pnpm vitest run test/experience-live/transcript-builder.test.ts
pnpm vitest run test/experience-live/test-runner/asserter.test.ts
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ENCLAWS_LIVE_TEST` | — | 设为 `1` 启用 live test，否则跳过 |
| `TEST_DATA_DIR` | `test-data/` | 场景 JSON 文件目录 |
| `TEST_CSV_OUTPUT` | `test-results/{timestamp}.csv` | CSV 报告输出路径 |

## 目录结构

```
test/experience-live/
├── experience.live.test.ts       # Vitest 入口（ENCLAWS_LIVE_TEST 门控）
├── types.ts                      # 类型定义（场景、断言、模型配置、结果行）
├── test-env.ts                   # 测试环境：DB 连接、模型加载、临时 workspace 管理
├── llm-client.ts                 # 轻量 LLM HTTP 客户端（openai-completions / anthropic-messages）
├── transcript-builder.ts         # 构建 JSONL transcript 文件（与 agent runner 格式一致）
├── transcript-builder.test.ts    # transcript-builder 单元测试
├── test-runner/
│   ├── runner.ts                 # 场景执行引擎：对话 → capture → distill → 断言
│   ├── asserter.ts               # 断言逻辑：验证 candidates 和 distilled records
│   ├── asserter.test.ts          # asserter 单元测试
│   ├── csv-writer.ts             # CSV 报告生成
│   └── file-loader.ts            # JSON 场景文件加载器
├── test-data/                    # 测试场景（每个 JSON 文件一个场景）
│   ├── capture-facts.json        # 事实抽取
│   ├── capture-workflow.json     # 工作流抽取
│   ├── capture-skip-memory.json  # MEMORY.md 去重
│   ├── capture-empty.json        # 空对话跳过
│   └── full-pipeline.json        # 完整 capture → distill 链路
└── test-results/                 # CSV 测试报告（自动生成，勿提交）
```

## 执行流程

每个场景依次执行以下步骤：

1. **创建临时 workspace** — 包含 `experience/candidates/` 目录和可选 `MEMORY.md`
2. **构建 transcript** — 对每个 turn 调用真实 LLM 获取回复，写入 JSONL 文件
3. **运行 capture** — 调用 `extractCandidates()` 从 transcript 中抽取 experience candidates
4. **验证 capture 断言** — 检查 candidates 数量、kind、summary 内容
5. **运行 distill**（如果有 `distillAssert`） — 调用 `runDistill()` 合并 candidates 为 distilled records
6. **验证 distill 断言** — 检查 records 数量、summary 非空、provenance
7. **清理临时 workspace**

## 测试数据格式

每个场景是一个 JSON 文件：

```jsonc
{
  "name": "场景名称",                    // 用于日志和 CSV 报告
  "description": "场景描述",             // 可选，仅文档用途
  "systemPrompt": "你是一个技术助手",    // LLM 对话的系统提示词
  "turns": [                            // 多轮对话，每轮只定义用户消息
    { "user": "我们用 PostgreSQL 16" },
    { "user": "部署在 AWS 东京区域" }
  ],
  "memoryMd": "",                        // 可选，预填 MEMORY.md 内容（用于去重测试）
  "captureAssert": {                     // 可选，capture 阶段断言
    "minCandidates": 1,
    "maxCandidates": 10,
    "expectedKinds": ["fact"],
    "forbiddenKinds": [],
    "summaryContainsAny": ["PostgreSQL", "AWS"]
  },
  "distillAssert": {                     // 可选，distill 阶段断言（需先有 captureAssert）
    "minRecords": 1,
    "summaryNotEmpty": true,
    "hasSourceCandidateIds": true
  }
}
```

### 字段说明

**turns**

| 字段 | 类型 | 说明 |
|------|------|------|
| `user` | `string` | 用户发送的消息（LLM 回复由真实 API 生成） |

**captureAssert**

| 字段 | 类型 | 说明 |
|------|------|------|
| `minCandidates` | `number` | 最少 candidate 数量 |
| `maxCandidates` | `number` | 最多 candidate 数量（防止过度提取） |
| `expectedKinds` | `string[]` | 至少出现这些 kind（fact/preference/workflow/policy_hint/failure_pattern/tool_recipe） |
| `forbiddenKinds` | `string[]` | 不应出现这些 kind |
| `summaryContainsAny` | `string[]` | 任一 candidate 的 summary 包含列表中任一关键词 |

**distillAssert**

| 字段 | 类型 | 说明 |
|------|------|------|
| `minRecords` | `number` | 最少 distilled record 数量 |
| `summaryNotEmpty` | `boolean` | 每条 record 的 summary 非空 |
| `hasSourceCandidateIds` | `boolean` | 每条 record 包含 sourceCandidateIds（provenance） |

## 编写新场景

1. 在 `test-data/` 下创建新的 `.json` 文件
2. 设计 `turns` 中的对话问题，确保对话内容能触发目标 kind 的经验抽取
3. 设置合理的断言（LLM 输出有不确定性，断言不宜过严）
4. 运行测试验证

### 断言设计建议

- `minCandidates` / `maxCandidates` 留宽裕范围（LLM 可能多提或少提）
- `expectedKinds` 只断言最有把握的 kind
- `summaryContainsAny` 用多个关键词提高容错（中英文都加）
- 闲聊场景用 `maxCandidates: 0` 断言不应提取
- `memoryMd` 去重场景用 `maxCandidates` 上限而非严格 0（LLM 判断有不确定性）

### 场景示例：preference 抽取

```json
{
  "name": "偏好抽取",
  "systemPrompt": "你是一个友好的技术助手，用简短的中文回答。",
  "turns": [
    { "user": "我更喜欢用 Vim 写代码，不习惯 VS Code" },
    { "user": "代码风格我偏好 4 空格缩进，不用 tab" }
  ],
  "captureAssert": {
    "minCandidates": 1,
    "expectedKinds": ["preference"],
    "summaryContainsAny": ["Vim", "缩进", "indent", "tab"]
  }
}
```

## LLM 配置

测试自动从数据库 `tenant_models` 加载第一条活跃记录，无需额外配置。支持的 API 协议：

| 协议 | 说明 | 适用 provider |
|------|------|--------------|
| `openai-completions` | OpenAI 兼容 `/v1/chat/completions` | qwen、deepseek、openai、自定义 |
| `anthropic-messages` | Anthropic `/v1/messages` | anthropic |

LLM 客户端会自动处理 `base_url` 中已包含 `/v1` 的情况，避免路径重复。

## CSV 报告

每次运行自动生成 CSV 报告（UTF-8 BOM，Excel 可直接打开）：

| 列 | 说明 |
|----|------|
| Scenario | 场景名称 |
| Phase | conversation / capture / distill |
| Status | PASS / FAIL |
| Details | 成功时为统计信息，失败时为失败原因 |
| Duration | 耗时（ms） |

## 与其他测试框架的区别

| | Experience Live Test | Feishu Simulator | IM Simulator |
|---|---|---|---|
| 测试对象 | capture/distill 副作用 | AI 回复内容 | AI 回复内容 |
| 通信方式 | 直接调用 experience 模块 | 飞书 Open API | WebSocket RPC |
| 依赖 Gateway | 否 | 是 | 是 |
| LLM 调用 | 轻量 HTTP + Pi SDK | 完整 agent pipeline | 完整 agent pipeline |
| 断言目标 | candidates / distilled records | 回复文本 | 回复文本 |
