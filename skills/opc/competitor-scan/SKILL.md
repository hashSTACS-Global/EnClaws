---
name: competitor-scan
description: |
  扫垂类竞品账号近 N 天高赞内容（小红书/公众号/微博/抖音/知乎）。
  ⚠️ 本期 MVP 为接口 stub，实际实现依赖 EC src/browser/（chrome/cdp）接入。
metadata: { "openclaw": { "emoji": "🔭", "requires": { "bins": ["node"] } } }
---

# competitor-scan

扫指定账号列表的近期高赞内容，供选题策划官做竞品研究。

> ⚠️ **MVP 状态**：接口已定义但未实现，需要 EC `src/browser/` 接入。当前返回 `NOT_IMPLEMENTED`。

---

## 使用（接口设计）

```bash
node ./scan.js \
  --account-list "xhs:@某理财博主,xhs:@某基金博主,wechat_mp:基金投顾大全" \
  --days 7 \
  --min-likes 500
```

## 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `--account-list` | 是 | 格式：`<platform>:<handle>`，逗号分隔。支持 `xhs` / `weibo` / `douyin` / `zhihu` / `wechat_mp` |
| `--days` | 否 | 近 N 天，默认 7 |
| `--min-likes` | 否 | 互动门槛（低于不返回），默认 500 |
| `--max-per-account` | 否 | 每个账号最多返回几条，默认 10 |

## 输出（接口约定）

```json
{
  "ok": true,
  "fetched_at": "2026-04-23T06:30:00+08:00",
  "by_account": {
    "xhs:@某理财博主": {
      "platform": "xhs",
      "handle": "@某理财博主",
      "items": [
        {
          "title": "...",
          "url": "https://...",
          "published_at": "2026-04-21T...",
          "likes": 2340,
          "comments": 187,
          "tags": [...]
        }
      ]
    }
  },
  "total_items": 23
}
```

---

## 实现路径（后续）

1. 依赖 `src/browser/` bridge（同 platform-hotlist）
2. 每个账号：
   - xhs: `https://www.xiaohongshu.com/user/profile/<id>` → 卡片列表 → 按 likes 倒排
   - wechat_mp: 抓搜狗微信或第三方 `新榜` 的账号历史
   - 其他平台同理
3. 结果按 `published_at >= now - days` 过滤，再按 `likes >= min-likes` 过滤
4. 每个账号取前 `max-per-account` 条

---

## Agent 用法提示（给选题策划官）

**scan-topics** 典型调用：

```
在老板启用时可要求其提供 3-5 个垂类竞品账号，存 workspace/_config/competitors.md

scan-topics 执行时：
  读 competitors.md → account_list
  调 competitor-scan({account_list, days:7, minLikes:500})
  当前（MVP）：NOT_IMPLEMENTED → 跳过，选题从 platform-hotlist 和历史 published/ 反复盘
  实装后：拿 by_account.items → LLM 综合 hotlist 一起排序挑候选
```

## 边界

- **账号主页访问可能需登录**：小红书、抖音对未登录用户限制内容可见；需要 bridge 支持加载 cookie
- **反爬**：高频抓取易触发风控，建议每天 1 次且随机延迟
- **历史回溯深度**：`days` 建议 ≤ 30；平台 API/页面通常只暴露最近几十条内容
