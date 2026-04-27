---
name: wechat-personal-fetch
description: |
  以老板本人身份拉取个人微信私信 + 群消息，按游标增量。
  ⚠️ MVP 为接口 stub，底座未定（Windows 客户端 hook / 第三方协议服务 / 企微迁移 三选一待拍板）。
metadata: { "openclaw": { "emoji": "💬", "requires": { "bins": ["node"] } } }
---

# wechat-personal-fetch

拉老板个人微信自上次游标以来的新消息（私信 + 群聊）。

> ⚠️ **MVP 状态**：个人微信没有官方 API，底座方案待 EC 团队选型。当前返回 `NOT_IMPLEMENTED`。

---

## 使用（接口设计）

```bash
node ./fetch.js \
  --account 18612345678 \
  --identity-token-ref "secret://wechat-personal-token" \
  --since-cursor "2026-04-23T08:00:00Z" \
  --watch-policy all \
  --excluded-conversations "wxid_xxx,wxid_yyy"
```

## 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `--account` | 是 | 账号标识（手机号/wxid）|
| `--identity-token-ref` | 是 | 指向 `tenant.secrets` 里的 token key |
| `--since-cursor` | 否 | 上次游标（ISO datetime）；首次拉全量或近 24h |
| `--watch-policy` | 否 | `all` / `private-only` / `whitelist`（默认 all）|
| `--watched-conversations` | whitelist 时必填 | 白名单会话 id 列表 |
| `--excluded-conversations` | 否 | 排除的会话 id 列表（all 模式有效）|

## 输出（接口约定）

```json
{
  "ok": true,
  "account": "...",
  "fetched_at": "2026-04-23T09:00:00+08:00",
  "new_cursor": "2026-04-23T08:57:00Z",
  "messages": [
    {
      "id": "msg_unique_id",
      "conversation_id": "wxid_xxx_or_roomid",
      "conversation_type": "private",
      "sender": { "id": "wxid_yyy", "display_name": "小王" },
      "content_type": "text",
      "content": "我想咨询一下合作",
      "received_at": "2026-04-23T08:45:00Z"
    }
  ],
  "count": 1
}
```

当前（MVP）：
```json
{
  "ok": false,
  "error": "NOT_IMPLEMENTED",
  "message": "个人微信无官方 API，EC 底座方案待选型（hook / 第三方协议 / 企微迁移）",
  "contract": { ... }
}
```

## 底座候选

| 方案 | 优 | 劣 |
|---|---|---|
| Windows 客户端 hook | 能拉所有消息 | 老板本机要一直开微信 PC 版；封号风险 |
| 第三方协议服务（云端）| 省心 | 付费 + 依赖 3rd party + 封号风险 |
| 企微迁移 | 合规最安 | 要引导粉丝迁账号 |

## Agent 用法提示

**社区管家 ingest-im** 主循环调用之一。`new_cursor` 要写回 `workspace/_config/business-channels/wechat-personal.md` 的 `since_cursor` 字段。

## 边界

- **不做历史回溯**：只拉 cursor 之后的增量
- **content_type**：当前设计覆盖 `text` / `image` / `voice` / `file` / `link` / `card`；MVP 先做 text
