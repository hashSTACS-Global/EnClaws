---
name: xiaohongshu-comment-reply
description: |
  回复小红书笔记评论。
  ⚠️ MVP 为接口 stub，依赖 src/browser/ 接入。
metadata: { "openclaw": { "emoji": "✍️", "requires": { "bins": ["node"] } } }
---

# xiaohongshu-comment-reply

以老板本人身份回复小红书评论。

> ⚠️ 依赖 src/browser/，当前返回 `NOT_IMPLEMENTED`。

---

## 使用（接口设计）

```bash
node ./reply.js \
  --identity-token-ref "secret://xiaohongshu-cookie" \
  --note-id "..." \
  --comment-id "..." \
  --content "..."
```

## 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `--identity-token-ref` | 是 | cookie/token 引用 |
| `--note-id` | 是 | 笔记 id |
| `--comment-id` | 是 | 被回复评论 id |
| `--content` | 是 | 回复文本 |

## 输出

```json
{ "ok": true, "replied_at": "<ISO>", "reply_id": "..." }
```

MVP stub：`{ ok:false, error:"NOT_IMPLEMENTED", ... }`

## 边界

- **账号安全优先**：失败时不重试（可能已发成功只是网络问题，盲重会双发惹恼用户）
- **频控**：小红书对机器行为敏感，连续回复间隔建议 ≥ 5 秒
