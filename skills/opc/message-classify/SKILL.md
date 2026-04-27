---
name: message-classify
description: |
  把 IM 消息或评论归到 4 档：粉丝咨询 / 合作询盘 / 普通互动 / spam。
  纯 LLM 分类，不调外部服务。社区管家 ingest-im 主力 skill。
metadata: { "openclaw": { "emoji": "🗂️", "requires": { "llm": true } } }
---

# message-classify

对一批消息做 4 档分类，返回每条带 `classification` 的结构化结果。

> **本 skill 只是分类规则说明 + 输出格式约定**，分类动作由调用此 skill 的 agent 用自身 LLM 完成。不产生外部调用、不调脚本。

---

## 分类枚举（4 档）

| classification | 含义 | 典型 |
|---|---|---|
| `fan-question` | 粉丝咨询 | "这支基金现在能买吗"、"你用的哪款相机"、实际向博主请教 |
| `collaboration-inquiry` | 合作询盘 | "想合作"、"品牌方寻代投"、"广告位多少"、"置换/置换互推" |
| `casual-interaction` | 普通互动 | 表情包、"学到了"、"支持"、短评、点赞后路过 |
| `spam` | 垃圾 | 广告灌水、卖货加 V、色情/违规、无意义刷屏 |

## 输入

```json
{
  "messages": [
    { "id": "m1", "sender": "...", "content": "..." },
    { "id": "m2", "sender": "...", "content": "..." }
  ]
}
```

## 输出（每条原样 + 加 `classification`）

```json
{
  "results": [
    { "id": "m1", "classification": "fan-question", "confidence": 0.85, "reason": "..." },
    { "id": "m2", "classification": "spam", "confidence": 0.92, "reason": "..." }
  ]
}
```

## Agent 用法提示（给调用者）

**批量调用更省 token**：一次传一批（10-50 条），LLM 一轮 prompt 搞定，不要一条一条跑。

**prompt 模板**（agent 组装 LLM 调用时用）：

```
你是消息分类器，按下面 4 档把用户消息分类：

- fan-question：粉丝向博主提具体问题或请教，希望得到回答
- collaboration-inquiry：品牌/代理/中间人询问合作（广告/带货/置换等）
- casual-interaction：情感类、点赞类、短反馈，不期待回复或回复价值低
- spam：广告灌水、卖货加 V、色情违规、无意义刷屏

判定规则：
- 含"合作/广告/推广/置换/品牌方/商务"等词 → 优先 collaboration-inquiry
- 含"+v/加微信 xxx/代理 xxx/扣号"等典型卖货话术 → spam
- 含具体问题（疑问句 + 具体产品/行为/数据）→ fan-question
- 其余礼貌性短话 → casual-interaction

输出 JSON 数组，每条包含 {id, classification, confidence, reason}。
reason 用 ≤ 10 字的一句话解释判定依据。

消息列表：
{{messages}}
```

## 边界

- **不做深度语义**：只是粗分流，后续精细处理由对应 action 承担（如询盘 → deal-inquiry-detect）
- **不做语言识别**：默认中文；其他语言消息 confidence 会偏低，agent 自行决策是否降级人审
- **命中多分类**：按**优先级**——合作询盘 > 粉丝咨询 > 普通互动 > spam（同一条既像"想合作"又像"粉丝问"的，优先按合作询盘处理）
