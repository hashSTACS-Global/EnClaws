---
name: wechat-mp-comment-fetch
description: |
  拉公众号文章评论（官方 API）。按文章或按时间窗口拉。
metadata: { "openclaw": { "emoji": "💭", "requires": { "bins": ["node"] } } }
---

# wechat-mp-comment-fetch

拉指定公众号文章的评论（已精选到后台的评论）。

> 使用公众号官方评论接口 `comment/list`。需要 appId + appSecret 和文章 msg_data_id（或 begin/end 时间）。
> access_token 与 wechat-mp-publish 共用缓存（`~/.enclaws/wechat-mp/<appId>.json`）。

---

## 使用

### 按文章拉所有评论

```bash
node ./fetch.js \
  --app-id wx0 --app-secret xxx \
  --msg-data-id "2247483650_1" \
  --index 0 \
  --begin 0 --count 50
```

### 按时间窗口扫

```bash
node ./fetch.js \
  --app-id wx0 --app-secret xxx \
  --since "2026-04-23T00:00:00Z"
```

## 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `--app-id` | 是 | appId |
| `--app-secret` | 是 | appSecret |
| `--msg-data-id` | 按文章拉时必填 | 群发消息 id（从 wechat-mp-publish 输出拿）|
| `--index` | 按文章拉时必填 | 图文消息中第几条文章（0 起）|
| `--begin` | 否 | 分页偏移，默认 0 |
| `--count` | 否 | 每页条数，默认 50，上限 50 |
| `--type` | 否 | 评论类型过滤：`all` / `normal` / `elected`，默认 all |

## 输出

```json
{
  "ok": true,
  "comments": [
    {
      "comment_id": "...",
      "author_openid": "...",
      "author_nickname": "...",
      "content": "好文！",
      "created_at": 1714000000,
      "is_top": false,
      "liked_count": 5,
      "replies": [
        { "content": "感谢支持", "created_at": ... }
      ]
    }
  ],
  "has_more": false,
  "total": 12
}
```

## Agent 用法提示

**社区管家 ingest-im** 的公众号评论分支：

```
读 workspace/published/(platform=wechat_mp) 近 7 天文章
对每篇：
  调 wechat-mp-comment-fetch({app_id, app_secret, msg_data_id, index})
  过滤 created_at > last_cursor
  调 message-classify 归 4 档
  写 messages/inbox/raw/{date}-...md
更新游标
```

## 边界

- **需要开通评论功能**：公众号后台要先打开"留言功能"（需认证服务号）
- **只能拉已精选到后台的评论**：未精选（用户点赞未达阈值）拉不到，公众号策略
- **速率**：`comment/list` 约 5000/天，够用
