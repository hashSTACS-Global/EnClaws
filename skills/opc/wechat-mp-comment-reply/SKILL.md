---
name: wechat-mp-comment-reply
description: |
  回复公众号文章评论（官方 API 作者回复）。
metadata: { "openclaw": { "emoji": "💬", "requires": { "bins": ["node"] } } }
---

# wechat-mp-comment-reply

以作者身份回复某条评论。

> 使用公众号官方评论接口 `comment/reply/add`。需要 appId + appSecret。

---

## 使用

```bash
node ./reply.js \
  --app-id wx0 --app-secret xxx \
  --msg-data-id "2247483650_1" \
  --index 0 \
  --user-comment-id "123" \
  --content "感谢关注！"
```

## 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `--app-id` | 是 | appId |
| `--app-secret` | 是 | appSecret |
| `--msg-data-id` | 是 | 群发消息 id（与 comment-fetch 输入一致）|
| `--index` | 是 | 图文第几条（0 起）|
| `--user-comment-id` | 是 | 评论 id（从 comment-fetch 输出取）|
| `--content` | 是 | 回复内容 |

## 输出

```json
{
  "ok": true,
  "replied_at": 1714000000,
  "user_comment_id": "123"
}
```

错误：`{ ok:false, errcode:..., errmsg:"..." }`

## Agent 用法提示

**OPC portal 侧** 老板在 Messages 页点[确认发送] → 调此 skill → 更新 reply 文件 status=sent。

## 边界

- **只能回已精选的评论**
- **已回复的评论重复调用会报错**：agent 先判断 `replies` 数组是否非空
- **速率**：约 5000/天，够用
