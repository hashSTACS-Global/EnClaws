---
name: platform-publish-pack
description: |
  为小红书/视频号/抖音/知乎等半自动平台生成"发布包"markdown 文件。
  老板在 OPC portal 打开发布包 → 长按复制全文 → 粘贴到 App 发布。
metadata: { "openclaw": { "emoji": "📋", "requires": { "bins": ["node"] } } }
---

# platform-publish-pack

把已适配过的内容打包成一个标准 markdown 文件，供老板在 OPC portal 复制粘贴到对应 App。

> 纯文本格式化脚本，**不调 LLM、不调外部 API**。

---

## 使用

```bash
# 直接传内容
node ./pack.js \
  --platform xiaohongshu \
  --title "基金小白避坑 5 招" \
  --body "今天聊聊..." \
  --hashtags "#基金,#理财,#小白" \
  --cover-hint "温暖蓝色简洁图文" \
  --output-dir "/path/to/workspace/publish_packs" \
  --short-id "a3f2"

# 从文件读长正文
node ./pack.js \
  --platform xiaohongshu \
  --title "..." \
  --body-file "/tmp/body.md" \
  --hashtags "#..." \
  --output-dir "..." \
  --short-id "a3f2"
```

## 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `--platform` | 是 | `xiaohongshu` / `shipinhao` / `douyin` / `zhihu` 等 |
| `--title` | 是 | 发布标题 |
| `--body` | 是（或 `--body-file`）| 正文 |
| `--body-file` | 是（或 `--body`）| 从文件读正文 |
| `--hashtags` | 否 | 逗号分隔，如 `#基金,#理财` |
| `--cover-hint` | 否 | 封面图建议（文字描述）|
| `--cover-url` | 否 | 封面图 URL（若已有）|
| `--output-dir` | 是 | 输出目录（通常是 `workspace/publish_packs/`）|
| `--short-id` | 是 | 8 位左右的 ID，用于文件命名 |
| `--draft-ref` | 否 | 关联的 draft id（记录进 frontmatter）|

## 输出（single-line JSON）

```json
{
  "ok": true,
  "path": "/path/to/workspace/publish_packs/2026-04-23-a3f2-xiaohongshu.md",
  "platform": "xiaohongshu"
}
```

## 生成的发布包 markdown 示例

```
---
type: publish_pack
platform: xiaohongshu
title: "基金小白避坑 5 招"
hashtags: ["#基金", "#理财", "#小白"]
cover_hint: "温暖蓝色简洁图文"
status: pending_user_publish
draft_ref: "drafts/2026-04-23-a3f2.md"
generated_at: "2026-04-23T11:05:00+08:00"
---

# 📋 发布包：小红书

## 1. 标题（复制到 App）

> 基金小白避坑 5 招

## 2. 正文（复制到 App）

```
今天聊聊...
（完整正文）
```

## 3. 标签（附加在正文末尾）

#基金 #理财 #小白

## 4. 封面图

提示：温暖蓝色简洁图文

## 5. 发布步骤

- [ ] 复制标题
- [ ] 复制正文
- [ ] 复制标签
- [ ] 准备/上传封面图
- [ ] 在小红书 App 发布
- [ ] 回 OPC portal 点「我已发布」
```

## Agent 用法提示（给分发编辑）

**adapt-and-schedule** 末尾典型调用：

```
对每篇 approved draft：
  先调 platform-format-adapt 得到 adapted（含 title/body/hashtags/cover_hint）
  对半自动平台 p：
    调 platform-publish-pack({
      platform: p,
      title: adapted.title,
      body: adapted.body,
      hashtags: adapted.hashtags.join(','),
      coverHint: adapted.cover_hint,
      outputDir: 'workspace/publish_packs',
      shortId: draft.id,
      draftRef: draft.path
    })
  → 得到 publish_pack 文件路径
  → 更新 draft.frontmatter.publish_packs[p] = 路径
```
