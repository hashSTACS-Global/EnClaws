---
name: wechat-personal-reply
description: |
  以老板本人身份发送个人微信回复（给特定会话）。配套 wechat-personal-fetch 使用。
  ⚠️ MVP 为接口 stub，底座同 wechat-personal-fetch 待选型。
metadata: { "openclaw": { "emoji": "📤", "requires": { "bins": ["node"] } } }
---

# wechat-personal-reply

回复个人微信消息。

> ⚠️ 底座未定，当前返回 `NOT_IMPLEMENTED`。

---

## 使用（接口设计）

```bash
node ./reply.js \
  --account 18612345678 \
  --identity-token-ref "secret://wechat-personal-token" \
  --conversation-id "wxid_yyy" \
  --conversation-type private \
  --reply-to-message-id "msg_xxx" \
  --content-type text \
  --content "您好，合作咨询请..."
```

## 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `--account` | 是 | 账号标识 |
| `--identity-token-ref` | 是 | token 引用 |
| `--conversation-id` | 是 | 会话 id（wxid 或 roomid）|
| `--conversation-type` | 是 | `private` / `group` |
| `--reply-to-message-id` | 否 | 指定引用回复（如果平台支持）|
| `--content-type` | 否 | `text` / `image` / `file` / `card`，默认 `text` |
| `--content` | 是（text）| 文本内容 |
| `--media-path` | 是（image/file）| 本地文件路径 |

## 输出

成功：
```json
{
  "ok": true,
  "sent_at": "2026-04-23T08:50:00+08:00",
  "message_id": "msg_new_id"
}
```

MVP stub：`{ ok:false, error:"NOT_IMPLEMENTED", ... }`

## Agent 用法提示

**社区管家 curate-and-reply** 的老板审过分支调用（OPC portal 侧）：
```
老板在 Messages 页对 messages/replies/(pending_review) 的某条点[确认发送]
→ OPC portal 调 wechat-personal-reply({conversation_id, content}) 真发
→ 更新 reply 文件 frontmatter status=sent
```

## 边界

- **速率**：由底座方案决定；typical 1 条/秒以内安全
- **发送失败重试**：本 skill 不做重试，调用方决策
- **撤回/编辑**：不支持（个人微信 API 不稳定）
