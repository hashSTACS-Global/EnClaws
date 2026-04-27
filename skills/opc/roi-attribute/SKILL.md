---
name: roi-attribute
description: |
  把当日收入（平台分成 / 知识付费 / 合作结款）归因到具体 published/ 条目。
  财务助理 daily-income 的核心 skill。
metadata: { "openclaw": { "emoji": "💰", "requires": { "llm": true } } }
---

# roi-attribute

把一批收入记录关联到具体已发内容，用于 ROI 分析。

> 纯 LLM + 时间窗口 + 字段匹配。不调脚本。

---

## 输入

```json
{
  "incomeRecords": [
    {
      "id": "inc1",
      "source": "wechat_mp_ads",
      "amount": 45.80,
      "received_at": "2026-04-23T20:00:00Z",
      "meta": { "article_id": "art_xxx" }
    },
    {
      "id": "inc2",
      "source": "knowledge_paid",
      "amount": 199.00,
      "received_at": "2026-04-23T14:22:00Z",
      "meta": { "course": "基金小白课" }
    },
    {
      "id": "inc3",
      "source": "deal_settlement",
      "amount": 1500,
      "received_at": "2026-04-23T10:15:00Z",
      "meta": { "deal_id": "deal_abc" }
    }
  ],
  "publishedList": [
    {
      "id": "pub1",
      "title": "...",
      "platform": "wechat_mp",
      "platform_article_id": "art_xxx",
      "published_at": "2026-04-20T14:00:00Z",
      "deal_ref": null
    },
    {
      "id": "pub2",
      "title": "基金小白避坑 5 招",
      "platform": "xiaohongshu",
      "published_at": "2026-04-10T19:00:00Z",
      "deal_ref": null
    },
    {
      "id": "pub3",
      "title": "某基金平台合作软文",
      "platform": "wechat_mp",
      "published_at": "2026-04-22T14:00:00Z",
      "deal_ref": "deal_abc"
    }
  ]
}
```

## 输出

```json
{
  "attributions": [
    {
      "income_id": "inc1",
      "matched_published": "pub1",
      "confidence": 0.99,
      "method": "exact_article_id"
    },
    {
      "income_id": "inc2",
      "matched_published": "pub2",
      "confidence": 0.72,
      "method": "semantic_match_title",
      "reason": "课程名 '基金小白课' 与文章标题 '基金小白避坑' 主题一致且发布在购买前 13 天"
    },
    {
      "income_id": "inc3",
      "matched_published": "pub3",
      "confidence": 1.0,
      "method": "deal_ref_match"
    }
  ],
  "unmatched": [],
  "summary": {
    "total_matched": 3,
    "total_unmatched": 0,
    "by_published": {
      "pub1": { "count": 1, "amount": 45.80 },
      "pub2": { "count": 1, "amount": 199.00 },
      "pub3": { "count": 1, "amount": 1500 }
    }
  }
}
```

## 三种匹配方法（优先级从高到低）

1. **`exact_article_id`**：平台返回的 article_id 精确命中 → confidence 0.99+
2. **`deal_ref_match`**：收入里的 deal_id 与 published 的 deal_ref 匹配 → confidence 1.0（结款类）
3. **`semantic_match_title`**：时间窗口内（收入前 30 天）+ 标题/内容语义相关 + 同平台 → confidence 0.5-0.9
4. **未匹配到** → 进 unmatched 数组，agent 决定如何呈现给老板（比如"散客打赏"等）

## Agent 用法提示

**财务助理 daily-income** 典型调用：

```
1. 拉今日平台统计 → 生成 wechat_mp_ads / xiaohongshu_platform_share 等记录
2. 读 deals/completed/(今日) → 生成 deal_settlement 记录
3. 读 income/raw/{date}.md（老板手贴 / CSV 导入）→ 其他流水记录
4. 读近 30 天 published/* → publishedList
5. 调 roi-attribute（全部一次传入）
6. 按 summary.by_published 排序，标记"今日最赚钱"
7. unmatched 部分单列，供老板手动对账
```

## prompt 模板（仅用于 semantic_match_title 阶段）

```
给下面这笔收入匹配最可能的来源文章：

收入：
- 来源：{{source}}
- 金额：{{amount}}
- 时间：{{received_at}}
- 备注：{{meta}}

候选文章（按发布时间倒序，均在收入前 30 天内）：
{{publishedList}}

匹配规则：
- 主题相关性（标题 / 正文关键词重合）
- 平台匹配（wechat_mp 收入 → wechat_mp 文章）
- 时间合理性（知识付费通常在阅读后 1-7 天）

输出 JSON：{ matched_published_id, confidence (0-1), reason }
都不相关时返回 null。
```

## 边界

- **粗粒度归因**：本 skill 不做用户级别归因（谁读了哪篇然后买的），只到"文章 → 收入"级
- **时间窗口**：收入前 30 天内的文章才进候选（超过认为关联弱）
- **跨平台关联**：不做（比如小红书种草 → 公众号购买的关联），本期限制在同平台
- **配置化**：后续可以把时间窗口 / 权重做成参数，本期硬编码
