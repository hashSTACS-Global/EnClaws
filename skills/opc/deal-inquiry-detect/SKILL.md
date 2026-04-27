---
name: deal-inquiry-detect
description: |
  识别合作询盘、判断意图、生成初步报价建议。
  商务经理信息收集 + 生成报价两个 action 的核心 skill。
metadata: { "openclaw": { "emoji": "💼", "requires": { "llm": true } } }
---

# deal-inquiry-detect

对合作询盘做深度分析：是否真询盘 / 对方诉求 / 历史合作参照 / 建议报价区间。

> 纯 LLM skill（可选拼接 workspace 历史数据）。不调外部品牌数据服务。

---

## 两种调用模式

### 模式 1 · 轻识别（社区管家 ingest-im 的 urgent 确认）

**目的**：社区管家 urgent 关键词命中后，再确认"是不是真的合作询盘"，避免误报。

输入：
```json
{
  "mode": "detect",
  "message": { "sender": "...", "content": "..." }
}
```

输出：
```json
{
  "isInquiry": true,
  "confidence": 0.88,
  "signals": ["含'想合作'", "提到'品牌方'", "首次接触"],
  "reason": "明确表达合作意向"
}
```

### 模式 2 · 完整分析（商务经理生成报价）

**目的**：信息收集完成（★ 字段全齐），产出报价建议给老板审。

输入：
```json
{
  "mode": "analyze",
  "deal": {
    "conversation_thread": [...全部对话轮...],
    "brand": "识别到的品牌名",
    "product": "...",
    "collaboration_type": "wechat_mp_softad | xiaohongshu_note | ...",
    "their_budget": 1500,
    "timeline": "2026-05-01 前"
  },
  "context": {
    "blacklist": ["赌博", "贷款"],
    "our_account": {
      "followers": { "wechat_mp": 50000, "xiaohongshu": 30000 },
      "niche": "年轻人理财科普"
    },
    "similar_deals_history": [
      { "brand": "某基金平台", "type": "wechat_mp_softad", "amount": 1800 }
    ]
  }
}
```

输出：
```json
{
  "isBlacklisted": false,
  "intent": "品牌方直接询价，明确想要公众号软文 + 小红书笔记双发",
  "price_suggestion": {
    "min": 1200,
    "mid": 1800,
    "max": 2500,
    "reasoning": "粉丝量 + 合作形式 + 类似历史成交 1800，对方预算 1500 偏低；建议报 1800，可下探到 1500 保交易"
  },
  "risks": [
    "对方预算比建议中位数低 17%",
    "未确认对方是品牌方还是代理"
  ],
  "next_action": "quote"
}
```

`next_action`：`quote`（可以生成报价）/ `gather_more`（还需要问清）/ `decline`（建议拒绝，比如命中黑名单）

## Agent 用法提示

**社区管家 ingest-im**（模式 1）：

```
消息被 message-classify 归到 collaboration-inquiry 后 →
  调 deal-inquiry-detect({mode:'detect', message}) 二次确认：
    isInquiry=true 且 confidence ≥ 0.75 → 真询盘，写 messages/leads/ + 唤醒商务经理
    否则 → 当普通 faq 处理
```

**商务经理 生成报价**（模式 2）：

```
deal.stage 推进到 ready_for_quote 时 →
  组装 context（读本账号 meta + workspace/deals/completed/ 的历史）→
  调 deal-inquiry-detect({mode:'analyze', deal, context}) →
    next_action=quote: 写 deal.price_suggestion，推老板审
    next_action=gather_more: 回退到 gathering_info，追问 risks 里提到的信息
    next_action=decline: 通知老板"建议拒单，理由 xxx"
```

## prompt 模板

### 模式 1（轻识别）
```
判断下面这条 IM 消息是否真合作询盘（而非随口说笑或被误判的非商业咨询）：

消息：{{message.content}}
发送者：{{message.sender}}

是合作询盘的信号：
- 明确提"合作/广告/推广/置换/商务/品牌"等词
- 带自我介绍（"我是 xx 品牌/代理"）
- 问报价、合作形式、排期等商业问题

不是合作询盘的信号：
- 只是随口问"你接广告吗"没下文
- 开玩笑语境
- 问询本人兴趣类（像粉丝问），没商业意图

输出 JSON：{ isInquiry, confidence (0-1), signals（命中的信号短语）, reason }
```

### 模式 2（完整分析）
```
你是资深自媒体商务经理，为博主生成合作报价建议。

博主情况：
- 粉丝：{{our_account.followers}}
- 垂类：{{our_account.niche}}

Deal 已收集信息：
- 品牌：{{brand}}
- 产品：{{product}}
- 合作形式：{{collaboration_type}}
- 对方预算：{{their_budget}}
- 时间要求：{{timeline}}

黑名单（绝对不接）：{{blacklist}}
类似合作历史：{{similar_deals_history}}
完整对话：{{conversation_thread}}

任务：
1. 判断是否命中黑名单（命中即 next_action=decline）
2. 综合粉丝量 + 合作形式 + 历史成交价，给出 [min, mid, max] 报价区间（单位：元）
3. 对比对方预算，给出 reasoning（低于 min 时要说明是否降价保交易 / 建议拒绝）
4. 列出风险点（对方身份未确认 / 预算偏差大 / 时间紧 等）
5. 决定 next_action：quote / gather_more / decline

输出 JSON（见 skill 文档）。
```

## 边界

- **对方品牌历史** MVP 阶段只依赖 `context.similar_deals_history`（从 workspace `deals/completed/` 聚合），不调外部品牌数据库
- **价格参考数据库**：本期不做，全靠 LLM + context 推理；后续可以让财务助理把已完成 deal 的平均单价汇总到 `_index/deal-benchmarks/`
- **多轮对话**：长对话（> 30 轮）时 agent 应做摘要再传入，避免 token 爆炸
