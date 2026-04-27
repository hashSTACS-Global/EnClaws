---
name: message-quality-rank
description: |
  给消息按 5 维度打质量分并排序：粉丝粘性 / 问题质量 / 热度聚合 / 新粉互动 / 情感价值。
  社区管家"精选回复"时用：选 top N 起草回复。
metadata: { "openclaw": { "emoji": "🏅", "requires": { "llm": true } } }
---

# message-quality-rank

对一批消息按"值不值得回"打分并排序，返回每条带 `score` / `rank` / `reasons` 的结构化结果。

> 纯 LLM 打分 skill，不调脚本。调用者用 agent 自身 LLM 按下方 prompt 模板完成。

---

## 打分 5 维度（每维 0-10）

| 维度 | 加分信号 | 扣分信号 |
|---|---|---|
| **粉丝粘性** `loyalty` | senderHistory 显示多次互动、老粉 | 首次出现的账号（此维度低，但看新粉维度可补偿）|
| **问题质量** `quality` | 具体、真诚、有延展性（给人启发、能回出长回答）| 一句话"好"、表情包、空泛赞美 |
| **热度聚合** `heat` | 多人问同类问题（回一条模板覆盖多人）| 完全单一孤立的问题 |
| **新粉互动** `new_fan` | 首次互动 + 内容真诚（留住新粉价值高）| 已互动多次的普通互动 |
| **情感价值** `emotional` | 特别走心的长评、精准夸赞、真实情感表达 | 敷衍短句 |

## 输入

```json
{
  "messages": [
    { "id": "m1", "sender": "u_a", "content": "这支基金..." }
  ],
  "senderHistory": {
    "u_a": { "interactions": 12, "first_seen_days_ago": 180 }
  },
  "topNKeywords": ["基金", "理财"]
}
```

`senderHistory` 和 `topNKeywords` 可选。没提供时：
- 无 history → `loyalty` 按中性分（5）、`new_fan` 默认为 5（当作新粉）
- 无 keywords → `heat` 维度靠 LLM 自己看 batch 里有没有重复主题

## 输出

```json
{
  "results": [
    {
      "id": "m1",
      "score": 7.8,
      "rank": 1,
      "scores": { "loyalty": 8, "quality": 9, "heat": 7, "new_fan": 3, "emotional": 5 },
      "reasons": ["问题具体、有延展", "老粉多次互动"]
    }
  ]
}
```

`score` = 5 维加权平均（权重：loyalty 0.25 · quality 0.30 · heat 0.20 · new_fan 0.15 · emotional 0.10）。
`rank` = 在本 batch 内排名（从 1 开始）。

## Agent 用法提示

**社区管家 curate-and-reply** 典型调用：

```
1. 拉今日 pending_curation=true 的消息
2. 按 sender 分组查 senderHistory（从 workspace/_index/sender-history/ 读）
3. 调 message-quality-rank 一轮
4. 按 rank 取 top N（N ≤ dailyReplyMax）
5. 但：只取 score ≥ 6.0 的（质量达标门槛，不够 N 条就少于 N 条，不强凑）
```

## prompt 模板（agent 组装）

```
你是消息质量评分器。按 5 个维度给每条消息打分（0-10 整数）：

- loyalty：发言者粘性（看 senderHistory 里的 interactions 和 first_seen_days_ago）
- quality：问题本身质量（具体性 / 延展性 / 真诚度）
- heat：是否热点（batch 里多人问同类或命中 topNKeywords）
- new_fan：是否首次互动的新粉（history 为 0 + 内容真诚加分）
- emotional：情感价值（走心 / 长评 / 精准夸赞加分）

然后按权重算加权总分：
  score = loyalty*0.25 + quality*0.30 + heat*0.20 + new_fan*0.15 + emotional*0.10

输出 JSON，每条 { id, score（保留1位小数）, scores对象, reasons（最多2个简短理由） }。
最后按 score 降序排 rank。

消息 batch：
{{messages}}

Sender history：
{{senderHistory}}

Top keywords（可选）：
{{topNKeywords}}
```

## 边界

- **质量门槛由调用方决定**：本 skill 只打分排序，不丢弃消息。社区管家自己按 score ≥ 6.0 筛
- **不做情感倾向分析**：只分"值不值得回"；情感正负留给 message-classify 负责 casual vs fan-question 的界定
