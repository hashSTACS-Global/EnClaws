---
name: wechat-mp-publish
description: |
  微信公众号官方 API：创建草稿 / 发布 / 拉文章统计。
  需要 appId + appSecret（老板在启用"分发编辑"时授权）。
metadata: { "openclaw": { "emoji": "📯", "requires": { "bins": ["node"] } } }
---

# wechat-mp-publish

通过公众号官方 API 自动创建草稿并发布（分发编辑的"自动发"路径）。

> access_token 自动缓存（2 小时有效），落地到 `~/.enclaws/wechat-mp/<appId>.json`。
> 输出 single-line JSON。

---

## Actions

### `create-draft` — 创建草稿

```bash
node ./publish.js --action create-draft \
  --app-id wx0000 --app-secret xxx \
  --title "..." --content "..." \
  --cover-media-id "xxx" \
  --author "小林" \
  --digest "..."
```

或从文件读正文：

```bash
node ./publish.js --action create-draft \
  --app-id wx0000 --app-secret xxx \
  --title "..." --content-file "/tmp/body.html" \
  --cover-media-id "xxx"
```

返回：`{ ok:true, media_id: "...", title: "..." }`

### `publish` — 把草稿发出去

```bash
node ./publish.js --action publish \
  --app-id wx0000 --app-secret xxx \
  --media-id "draft_media_id"
```

返回：`{ ok:true, publish_id: "...", msg_data_id: "..." }`

### `upload-cover` — 上传封面永久素材（如果还没拿到 cover-media-id）

```bash
node ./publish.js --action upload-cover \
  --app-id wx0000 --app-secret xxx \
  --image-path "/tmp/cover.png"
```

返回：`{ ok:true, media_id: "...", url: "..." }`

### `stats` — 拉文章统计（阅读数/点赞/转发）

```bash
node ./publish.js --action stats \
  --app-id wx0000 --app-secret xxx \
  --media-id "..." \
  --since 2026-04-20 \
  --until 2026-04-23
```

返回：`{ ok:true, stats: { reads, likes, shares, reposts } }`（真实字段按公众号接口返回）

---

## 参数总览

| 参数 | 适用 action | 说明 |
|---|---|---|
| `--app-id` | 全部 | 公众号 appId |
| `--app-secret` | 全部 | 公众号 appSecret（**敏感**，由 EC tenant.secrets 管理后注入）|
| `--action` | 全部 | create-draft / publish / upload-cover / stats |
| `--title` | create-draft | 文章标题 |
| `--content` | create-draft | HTML 正文（与 content-file 二选一）|
| `--content-file` | create-draft | 从文件读 HTML 正文 |
| `--cover-media-id` | create-draft | 封面图 media_id（需先 upload-cover 或从老板素材库取）|
| `--author` | create-draft | 作者名 |
| `--digest` | create-draft | 摘要，最多 120 字 |
| `--source-url` | create-draft | 原文链接 |
| `--media-id` | publish / stats | 草稿 media_id |
| `--image-path` | upload-cover | 本地图片路径（jpg/jpeg/png/gif，≤ 2MB）|
| `--since` / `--until` | stats | 统计区间，YYYY-MM-DD |

---

## Agent 用法提示（给分发编辑）

**典型 publish-or-pack 分支**：

```
对每篇 status=approved 且 target 含 wechat_mp 的 draft：
  1. 调 platform-format-adapt({content, targetPlatform:'wechat_mp'}) → adapted
  2. 若有本地封面图：
     调 wechat-mp-publish({action:'upload-cover', ...}) → cover_media_id
  3. 调 wechat-mp-publish({action:'create-draft', title, content, cover_media_id, ...}) → media_id
  4. 立即发布：
     调 wechat-mp-publish({action:'publish', media_id}) → publish_id
  5. 写 workspace/published/{date}-{shortId}.md 记录
  6. notification.dispatch → "✅ 公众号《{{title}}》已自动发布"
```

**次日 财务助理**（stats）：

```
对昨天 published/ 里 platform=wechat_mp 的条目：
  调 wechat-mp-publish({action:'stats', media_id, since, until})
  → 写 analytics/wechat_mp/{date}.md
```

---

## 错误处理

公众号 API 常见错误：
- `40001` access_token 失效 → 本 skill 自动刷新 token 重试一次
- `45009` 超频率限制 → agent 建议降级"半自动"路径
- `53605` 内容被风控 → agent 通知老板"公众号风控命中，请检查内容"

所有错误输出：`{ ok:false, errcode, errmsg, retry_after? }`

## token 缓存

- 位置：`~/.enclaws/wechat-mp/<appId>.json`
- 格式：`{ access_token, expires_at }`（expires_at 留 5 分钟 buffer）
- 失效时自动重新获取

## 边界

- **仅公众号官方 API**，不做接口逆向
- **群发**走 `freepublish/submit`（新版群发接口），不用老版 `message/mass/send`
- **图文素材**：首图走 `cover-media-id`；正文里的图需要老板先在公众号后台上传素材，本 skill 暂不做"图片转永久素材 + 替换正文 img src"这类完整渲染
