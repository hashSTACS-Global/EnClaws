---
name: xiaohongshu-comment-fetch
description: |
  拉小红书笔记评论。
  ⚠️ MVP 为接口 stub，依赖 src/browser/（chrome/cdp）接入。
metadata: { "openclaw": { "emoji": "📕", "requires": { "bins": ["node"] } } }
---

# xiaohongshu-comment-fetch

拉指定小红书笔记的评论（增量按游标）。

> ⚠️ **MVP 状态**：小红书无官方 API，实际实现需要 `src/browser/`。当前返回 `NOT_IMPLEMENTED`。

---

## 使用（接口设计）

```bash
node ./fetch.js \
  --identity-token-ref "secret://xiaohongshu-cookie" \
  --note-id "65a1b..." \
  --since-cursor "2026-04-23T00:00:00Z" \
  --max 100
```

或按账号拉所有近期笔记的评论：

```bash
node ./fetch.js \
  --identity-token-ref "secret://xiaohongshu-cookie" \
  --user-id "..." \
  --since-cursor "..."
```

## 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `--identity-token-ref` | 是 | 指向 `tenant.secrets` 里的 cookie/token |
| `--note-id` | 二选一 | 单篇笔记 id |
| `--user-id` | 二选一 | 账号 id，拉该账号最近 N 篇笔记的评论 |
| `--since-cursor` | 否 | 上次游标，只取之后的 |
| `--max` | 否 | 最大返回条数，默认 100 |

## 输出

```json
{
  "ok": true,
  "fetched_at": "2026-04-23T...",
  "new_cursor": "2026-04-23T...",
  "comments": [
    {
      "comment_id": "...",
      "note_id": "...",
      "author_id": "...",
      "author_nickname": "...",
      "content": "好看",
      "created_at": "2026-04-22T...",
      "liked_count": 3,
      "replies": []
    }
  ],
  "count": 5
}
```

MVP stub：`{ ok:false, error:"NOT_IMPLEMENTED", ... }`

## 实现路径

1. 依赖 src/browser/ bridge 启动 headless chrome（加载老板授权的 cookie）
2. 打开笔记页或用户主页，提取评论 DOM / 抓接口响应
3. 按 `since-cursor` 过滤 → 归一化到通用 comment schema

## Agent 用法提示

**社区管家 ingest-im** 的小红书评论分支（启用 `xiaohongshu-comment` channel 时）：

```
读 workspace/_config/business-channels/xiaohongshu-comment.md 拿账号/cookie
调 xiaohongshu-comment-fetch（按 user-id 拉近期全部笔记的评论）
→ message-classify 归 4 档 → 写 inbox/
更新游标
```

## 边界

- **cookie 失效**：平台会不定期要求重新登录，fetch 失败时 agent 需通知老板"小红书需重授权"
- **速率**：小红书反爬严格，建议 ≥ 10 分钟一次调用 + 随机延迟
