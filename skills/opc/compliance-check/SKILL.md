---
name: compliance-check
description: |
  对一段文本做合规扫描，按 level 加载对应垂类词库 + 通用词库，返回结构化风险报告。
  用于选题/创作/回复发出前的合规兜底。
  level: general / finance / medical / law。
metadata: { "openclaw": { "emoji": "🛡️", "requires": { "bins": ["node"] } } }
---

# compliance-check

对一段文本做合规扫描，返回命中词、严重度、风险等级和改写建议。

> 只做**词库扫描**（确定性），不调用 LLM。Agent 拿到结构化结果后自己决定怎么做（丢弃 / 改写 / 通过）。

---

## 使用

```bash
# 直接传文本
node ./check.js --text "年化稳定 10% 保证收益" --level finance

# 从文件读长文
node ./check.js --text-file "/tmp/draft.md" --level general
```

## 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `--text` | 是（或 `--text-file`）| 要检查的文本 |
| `--text-file` | 是（或 `--text`）| 从文件读文本（长文用）|
| `--level` | 否 | `general`（默认）/ `finance` / `medical` / `law`；`general` 词库始终参与，再叠加对应垂类 |

## 输出（single-line JSON）

```json
{
  "ok": true,
  "level": "finance",
  "risk": "high",
  "hits": [
    {"term": "保证收益", "category": "承诺禁用", "severity": "severe", "position": 14},
    {"term": "年化稳定 10%", "category": "承诺禁用", "severity": "severe", "position": 0}
  ],
  "suggestion": "去掉或改写严重命中词: 保证收益、年化稳定 10%"
}
```

错误时：
```json
{"ok": false, "error": "text or text-file required"}
```

## 风险等级判定

- `high` — 有 ≥ 1 个 `severe` 命中
- `mid` — 无 `severe` 但 ≥ 2 个 `warning` 命中
- `low` — 其余

## Agent 用法提示

**选题策划官** `scan-topics`：对每条候选选题调一次，按 `risk`：
- `high` → 丢弃或明确标"合规风险，慎用"
- `mid` → 标"建议修改措辞"
- `low` → 通过

**内容创作官** 可选：生成初稿后调一次（目前 MVP 不强制，前置过滤由选题策划官做）。

## 词库扩展

词库放 `./lexicons/<level>.json`，按需增删：
- `general.json` — 所有垂类通用（绝对化用语、极端对立、引战等）
- `finance.json` — 金融（承诺收益、内幕、荐股等）
- `medical.json` — 医疗（疗效承诺、处方、秘方等）
- `law.json` — 法律（胜诉承诺、关系疏通等）

每个 JSON 结构：
```json
{
  "categories": {
    "<分类名>": {
      "severity": "severe" | "warning",
      "terms": ["词1", "词2", ...]
    }
  }
}
```

新增一个 level 只需加一个 `<level>.json` 文件，无需改代码。
