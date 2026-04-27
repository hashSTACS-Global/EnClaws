---
name: platform-hotlist
description: |
  抓指定平台热榜前 N 条，返回真实数据。
  当前已实现 3 个平台的真实 API 抓取：weibo / zhihu / bilibili（均无需登录，直连官方 JSON 接口）。
  xiaohongshu / douyin / wechat_mp 无公开热榜 API，会返回 browser_automation_required 错误（Phase 2 再做）。
metadata: { "openclaw": { "emoji": "🔥", "requires": { "bins": ["node"] } } }
---

# platform-hotlist

抓平台热榜前 N 条，作为「选题策划官」的真实选题候选源。

## 调用方式

**必须通过 exec 工具运行**，不要用 web_fetch / web_search（EC 的 SSRF 沙箱会拦截浏览器式抓取；本 skill 在子进程里直连平台 JSON 接口，不受沙箱约束）。

```bash
node ./hotlist.js --platform weibo --top-n 50 --vertical-keywords "基金,理财,副业"
```

## 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `--platform` | 是 | `weibo` / `zhihu` / `bilibili`（已实现，真实数据） |
| `--top-n` | 否 | 取前 N 条，默认 50（上限 50） |
| `--vertical-keywords` | 否 | 垂类关键词（逗号分隔）；命中的 item 会带 `vertical_match:true`，**不会删除未命中项**，由 agent 自行筛选 |

## 输出

成功（真实热榜）：
```json
{
  "ok": true,
  "platform": "weibo",
  "fetched_at": "2026-04-23T10:30:00.000Z",
  "source": "live",
  "items": [
    {
      "rank": 1,
      "title": "...",
      "author": null,
      "url": "https://s.weibo.com/weibo?q=%23...",
      "heat_score": 1234567,
      "excerpt": "...",
      "tags": []
    }
  ]
}
```

失败（抓取失败 / 平台风控 / 网络错误）：
```json
{
  "ok": false,
  "error": "fetch_failed",
  "platform": "weibo",
  "message": "http 403 from https://..."
}
```

未实现平台（小红书/抖音/公众号）：
```json
{
  "ok": false,
  "error": "browser_automation_required",
  "platform": "xiaohongshu",
  "supported_now": ["weibo", "zhihu", "bilibili"]
}
```

---

## 数据来源（当前实现）

| 平台 | 接口 | 需认证 |
|---|---|---|
| weibo | `https://weibo.com/ajax/side/hotSearch` | 否（公开 JSON） |
| zhihu | `https://api.zhihu.com/topstory/hot-list`（mobile UA） | 否 |
| bilibili | `https://api.bilibili.com/x/web-interface/popular` | 否 |

---

## Agent 使用规则（给选题策划官）

**铁律 1**：拿到就是拿到，拿不到就是拿不到。**严禁 LLM 自己脑补热榜内容、严禁用 verticalKeywords 自造 title、严禁降级到"老板手贴"作为 fallback**（除非老板明确要求）。

**铁律 2**：不要尝试 web_fetch 访问 weibo.com / zhihu.com / bilibili.com —— EC 沙箱会拒绝。只能通过本 skill 的 exec 调用。

**典型调用序列**（action="scan-topics"）：
```
for platform in activationSpec.platforms:
  result = exec("node ./hotlist.js --platform {platform} --top-n 50 --vertical-keywords {kw}")
  if result.ok:
    把 result.items 收集起来
  else:
    记录 error（不做 fallback）

if 收集到 items > 0:
  送 LLM 从真实 items 里选 3-5 条（保留原始 rank / url / heat_score）
  每条调 compliance-check 打标
  写 topics/{date}.md (status=pending_pick)
else:
  写 topics/{date}.md (status=failed)，内容只含各平台原始 error
  发通知："⚠️ 今日热榜全部拉取失败"
  本次终止
```

## 边界

- **反爬 / 风控**：weibo/zhihu/bilibili 当前接口都是公开的；若未来被封会返回 `fetch_failed`，不要硬刷
- **频率**：每天 1 次（06:30 scan-topics），远低于平台风控阈值
- **覆盖率**：取到多少算多少；返回的 items 即是全部可得数据，不在 skill 里补全
