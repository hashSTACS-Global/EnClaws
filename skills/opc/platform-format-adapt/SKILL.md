---
name: platform-format-adapt
description: |
  把一份初稿按目标平台调性改写：公众号长文 / 小红书短文+emoji / 视频号脚本 / 抖音脚本 / 知乎问答。
  纯 LLM prompt 工程，不调外部服务。分发编辑、内容创作官主力 skill。
metadata: { "openclaw": { "emoji": "🎨", "requires": { "llm": true } } }
---

# platform-format-adapt

把一段内容按目标平台的调性重写，保留核心观点但调整结构、语气、长度。

> 纯 LLM skill，不调脚本。

---

## 支持平台

| targetPlatform | 调性要点 |
|---|---|
| `wechat_mp` | 公众号长文。1000-2500 字，有小标题分段，结尾引导关注 / 在看 / 留言 |
| `xiaohongshu` | 小红书短文。300-600 字，标题前置 emoji（2-3 个），文末 3-5 个 `#hashtag`，口语化 |
| `shipinhao` | 视频号脚本。≤ 600 字口播稿，分镜标注（【画面】/【旁白】），15-60 秒总时长 |
| `douyin` | 抖音脚本。≤ 300 字快节奏口播，前 3 秒必须有钩子 |
| `zhihu` | 知乎问答。结构化（观点→论证→结论），中长篇 1500-3000 字，适度引用数据/出处 |

## 输入

```json
{
  "content": {
    "title": "年轻人第一份基金定投怎么避坑",
    "body": "...（原始内容，可能是公众号长文或短笔记）..."
  },
  "targetPlatform": "xiaohongshu",
  "hints": {
    "maxLength": 500,
    "styleSamples": ["...历史爆款 1...", "...历史爆款 2..."],
    "keepHashtags": ["#基金定投", "#理财"]
  }
}
```

`hints` 全可选。

## 输出

```json
{
  "adapted": {
    "title": "✨年轻人第一份基金怎么选？避坑 5 步🤏",
    "body": "...（改写后的正文）...",
    "hashtags": ["#基金定投", "#理财", "#小白理财"],
    "cover_hint": "简洁图文，主色温暖蓝色（建议）"
  },
  "meta": {
    "targetPlatform": "xiaohongshu",
    "adapted_length": 487,
    "style_matched": true
  }
}
```

`cover_hint` 是给 agent 提示用，老板可以拿去生成配图（本期不出配图）。

## Agent 用法提示（给分发编辑）

**典型调用序列**：

```
对每篇 status=approved 的 draft:
  对每个目标平台 P（从启用参数 publishTargets 取）:
    调 platform-format-adapt({
      content: draft,
      targetPlatform: P,
      hints: { styleSamples: 老板历史爆款 }
    })
    → 写到 draft 的 adapted[P] 字段
```

## prompt 模板（给各平台）

### wechat_mp
```
把下面内容改写成微信公众号长文风格：
- 1000-2500 字
- 有 3-5 个小标题（##）分段
- 段落短、易阅读
- 结尾加一段行动引导（关注 / 在看 / 留言）
- 不要加话题标签 / hashtags

原标题：{{title}}
原正文：{{body}}

输出 JSON: { title, body }
```

### xiaohongshu
```
把下面内容改写成小红书笔记风格：
- 300-600 字
- 标题前置 2-3 个 emoji，简短吸睛
- 正文口语化、多换行、每段 1-3 行
- 可用 emoji 点缀
- 结尾 3-5 个 #hashtag（含 {{keepHashtags}}）

风格参考（老板历史爆款）：
{{styleSamples}}

原标题：{{title}}
原正文：{{body}}

输出 JSON: { title, body, hashtags, cover_hint }
cover_hint：用一句话描述建议的封面图调性。
```

### shipinhao / douyin / zhihu

类似结构，按各自平台风格写 prompt，略。

## 边界

- **只做格式/调性适配**，不改核心观点或数据
- **不做事实核查**，原文错了改写也是错的（事实核查由 compliance-check 前置）
- **长度上限**：字数超 hints.maxLength 时 LLM 需主动裁剪重点
- **hashtag**：小红书/知乎必须产出；公众号/视频号不产出
