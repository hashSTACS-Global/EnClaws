### 第一次修改

只修改了一个文件：task.ts:370-377

改动内容：在 create action 的返回逻辑中，将 API 返回的 task 对象增加一个 task_url 字段后再返回。

改动前：

return json({
  task: res.data?.task,
});
改动后：

const task = data?.task;
if (task?.guid && task?.task_id) {
  task.task_url = `https://applink.feishu.cn/client/todo/detail?guid=${task.guid}&suite_entity_num=${task.task_id}`;
}
return json({
  task,
});

---

将飞书权限授权从被动（工具调用失败 → 逐个弹卡片授权）改为主动（skill 执行前一次性预检 + 聚合授权），同时区分 tenant/user token 类型减少不必要的用户 OAuth。

新建文件
src/tools/pre-auth.ts — feishu_pre_auth 工具

接收 tool_actions 数组，执行流程：

校验 action keys 合法性
splitByTokenType() 按 TOOL_TOKEN_TYPES 分成 tenant 组和 user 组
检查 app scope（两组都需要应用开通权限）
tenant 组：app scope 通过即完成，不触发 OAuth
user 组：检查用户已有 token 的 scope，缺失则调 executeAuthorize() 发一张聚合 OAuth 卡片
全部就绪返回 { all_authorized: true }
修改文件
架构层
文件	改动
src/core/tool-scopes.ts	新增 TOOL_TOKEN_TYPES 映射（列出 tenant 类工具）和 getTokenType() 函数
src/core/scope-manager.ts	导出 getTokenType
index.ts	导入并注册 registerFeishuPreAuthTool
工具代码 as: 'user' → as: 'tenant'
文件	工具	理由
src/tools/oapi/common/search-user.ts	feishu_search_user	搜索员工不需要用户身份，contact:user:search 支持 tenant token
src/tools/oapi/chat/chat.ts	feishu_chat.get	获取群信息，bot 已在群内，tenant token 即可
src/tools/oapi/chat/members.ts	feishu_chat_members	获取群成员，bot 已在群内，tenant token 即可
未改（需要用户视角）：feishu_chat.search、feishu_get_user

7 个 SKILL.md 新增 🔑 执行前权限预检 section
每个 skill 在正文顶部添加指令，告知 AI 在使用任何工具前必须先调用 feishu_pre_auth，并附带完整的 tool_actions JSON：

Skill	tool_actions 数量
feishu-task	18（含跨 skill 的 calendar_event.create）
feishu-calendar	16
feishu-bitable	27
feishu-im-read	3
feishu-create-doc	2
feishu-fetch-doc	3
feishu-update-doc	2
未修改：feishu-channel-rules（输出格式规则）、feishu-troubleshoot（FAQ/诊断）

效果对比
改动前	改动后
授权时机	工具调用失败后被动触发	skill 执行前主动预检
授权次数	每个缺权限的工具各弹一次	一次聚合授权（一张卡片）
tenant 类工具	走用户 OAuth（多余）	仅检查 app scope，无需扫码
用户体验	多次中断、多次扫码	最多一次扫码，后续工具全部畅通

--- 

Bug已修复。问题分析：

im:chat.members:read 不需要个人token。 在 tool-scopes.ts:367 中，feishu_chat_members.default 已经配置为使用 tenant token（应用身份），只需要在飞书开放平台给应用开通权限即可，不需要用户 OAuth 授权。

Bug 根因： 在 auto-auth.ts:848，当应用权限（app scope）缺失并被管理员补齐后，代码会把 flow.requiredScopes（包含 im:chat.members:read）加入 mergedScopes，然后触发用户 OAuth 授权流程。但 tenant-token 工具根本不需要用户授权，这导致了截图中不必要的权限申请提示。

修复： 当 flow.tokenType === 'tenant' 时，不将其 requiredScopes 加入 mergedScopes，这样 mergedScopes 为空会走直接重试路径（发送合成消息触发 AI 重新执行），跳过不必要的用户 OAuth。


---
总结一下修复的两个 bug：

Bug 1（本次修复）： "去申请" 链接硬编码 token_type=user

auto-auth.ts:456 — buildAppScopeMissingCard 原来硬编码 token_type=user，导致 feishu_chat_members（使用 tenant token）抛出 AppScopeMissingError 时，用户点"去申请"跳转到的是 user_access_token 权限页面。用户看到 im:chat.members:read 已经存在（在 user 标签下），以为权限已开通，但实际需要的是 tenant_access_token 标签下的权限。

修复：buildAppScopeMissingCard 新增 tokenType 参数，根据实际 token 类型生成正确的 URL（token_type=tenant 或 token_type=user）。

Bug 2（上次修复）： tenant 工具完成应用权限后不应触发用户 OAuth

auto-auth.ts:849-853 — 应用权限确认后，tenant 工具的 requiredScopes 不再加入 mergedScopes，走直接重试路径而非不必要的用户 OAuth 流程。

---

本次修改修复了飞书 API 返回 99991677（Authentication token expired，HTTP 401）时无法自动刷新 token 的 bug。涉及 3 个文件：

1. auth-errors.ts
LARK_ERROR 新增 AUTH_TOKEN_EXPIRED: 99991677
TOKEN_RETRY_CODES 集合中加入该错误码，使其可触发自动刷新重试
2. uat-client.ts
callWithUAT 中错误码提取逻辑从 err.code ?? err.response.data.code 改为先判断 typeof err.code === 'number'，再回退到 response.data.code
原因：HTTP 401 时 Axios 的 err.code 是字符串（如 "ERR_BAD_RESPONSE"），?? 不会回退，导致取不到飞书的数字错误码
3. tool-client.ts
rethrowStructuredError 中同步应用了相同的错误码提取修复
修复效果
之前：token 过期返回 99991677 → 不识别 → 直接报错让用户重新授权
之后：token 过期返回 99991677 → 自动 refresh token → 重试 API 调用 → 用户无感知

---

API 调用返回 99991677 → callWithUAT 识别（TOKEN_RETRY_CODES 已添加）
尝试 refreshWithLock → 刷新失败（因为你在飞书安全页面取消了授权）
之前：doRefreshToken throw 普通 Error → 穿透所有 catch → 只返回文字提示
现在：catch 住 refresh 错误 → 转为 NeedAuthorizationError → tool-client 转为 UserAuthRequiredError → handleInvokeErrorWithAutoAuth 命中 Path 1 → executeAuthorize → 弹出授权卡片

---

99991677 被识别 → 尝试刷新 ✓
刷新失败 code=20064 → 但 20064 不在 REFRESH_TOKEN_IRRECOVERABLE → doRefreshToken 没有清除本地 token → throw 普通 Error
我加的 catch 把它转为 NeedAuthorizationError → auto-auth 触发 executeAuthorize ✓
但 executeAuthorize 发现本地 token 还在且状态 "valid" → 跳过授权，直接返回
加上 20064 后的流程：

99991677 → 尝试刷新 ✓
刷新失败 code=20064 → 在 REFRESH_TOKEN_IRRECOVERABLE 中 → removeStoredToken() 清除本地 token → 返回 null
callWithUAT 抛出 NeedAuthorizationError → UserAuthRequiredError → auto-auth
executeAuthorize 发现本地无 token → 发起 Device Flow → 弹出授权卡片 ✓

---

API 调用返回 99991677 → callWithUAT 识别
刷新 token 失败（code=20064，已在 REFRESH_TOKEN_IRRECOVERABLE）→ 本地 token 被清除 → NeedAuthorizationError
handleInvokeErrorWithAutoAuth 捕获 UserAuthRequiredError
检测到本地无 token → getToolFamilyScopes("feishu_calendar_calendar.primary") → 收集所有 feishu_calendar_* 的 scope（包括 calendar:calendar:read、calendar:calendar.event:create、calendar:calendar.event:update、calendar:calendar.event:read 等）
一次性请求所有 scope → 只弹一次授权卡片

---

看到问题了。日志关键行：

07:25:10 UserAuthRequiredError → enqueue, scopes=[calendar:calendar:read]
07:25:10 existing token missing scopes [calendar:calendar:read], starting incremental auth
Token 是存在的（上一次授权获得了 calendar:calendar.event:create/read/update），但缺少 calendar:calendar:read（resolveCalendarIdOrFail 需要的）。我的 scope 扩展代码检查的是 if (!stored) — token 存在时不会扩展。

修复很简单：不管 token 是否存在，都应该用工具族 scope 扩展，避免反复授权。

---

原因：contact:user:search 只在飞书开放平台的 user_access_token 下提供，但代码把 feishu_search_user.default 配置为使用 tenant token。tenant 下没有这个权限，所以 app scope 检查失败。

修复：移除 feishu_search_user.default 的 tenant 配置，让它使用默认的 user token 类型

---

nvokeByPath 调用中硬编码了 as: 'tenant'，这会覆盖 tool-scopes.ts 中的配置。已改为 as: 'user'。

contact:user:search 权限只在 user_access_token 下可用，所以用 tenant token 去调用时，scope 检查会在 44 个 tenant scope 中找不到这个权限，导致 AppScopeMissingError。

现在两处都改好了：

tool-scopes.ts — 从 TOOL_TOKEN_TYPES 中移除了 feishu_search_user.default
search-user.ts — as: 'tenant' → as: 'user'

---

分析完日志后，问题已经明确了。当前的两次授权弹窗原因是：

feishu_search_user 还在用 as: 'tenant' → 触发 AppScopeMissingError → 发送应用权限卡片（橙色）
feishu_task_task 用 user token → 触发 UserAuthRequiredError → 发送 OAuth 授权卡片（蓝色）
这是两种完全不同的错误类型，走不同的 buffer key（app:... vs user:...），无法合并。

在部署了刚才的 search-user.ts 修复（as: 'tenant' → as: 'user'）后，两个工具都会抛出 UserAuthRequiredError，共享同一个 debounce buffer key user:${accountId}:${senderOpenId}:${messageId}。即使 search_user 立即失败而 task 需要 ~2s：

search_user 失败 → 入队 150ms debounce → flush → 发卡片 → 进入 executing 阶段
task ~2s 后失败 → 入队 → 命中 executing piggyback 路径 → 复用同一结果 + 触发 500ms scope 更新
scope 更新调用 executeAuthorize → 检测到 pendingFlows 中同 messageId 的 flow → 复用旧卡片原地更新，合并 scope，重启 device flow

---

现在总结修复方案：

根因：feishu_calendar_event 的所有动作内部都调用 resolveCalendarIdOrFail，该函数通过 feishu_calendar_calendar.primary API 获取用户主日历 ID，需要 calendar:calendar:read scope。但 tool-scopes.ts 里的 scope 配置没有包含这个内部依赖。

修复：在 tool-scopes.ts 中，给所有 feishu_calendar_event.* 动作补上 calendar:calendar:read。

这样：

feishu_pre_auth 请求 calendar_event.create 的 scope 时，会包含 calendar:calendar:read
auto-auth 的工具族扩展（feishu_calendar_*）也自然包含 calendar:calendar:read
一次授权就能覆盖 calendar 的全部需求
不需要请求全部 86 个权限，只需要确保 scope 配置完整反映了工具的实际依赖

---

feishu-task/SKILL.md — feishu_pre_auth 的 tool_actions 加入了 feishu_search_user.default
feishu-calendar/SKILL.md — 同样加入了 feishu_search_user.default
这样当 AI 触发 task skill 时，feishu_pre_auth 会一次性预检 search（contact:user:search）+ task（task:task:write 等）+ calendar（calendar:calendar:read 等）所有权限，缺失的 scope 合并到一次授权弹窗中，用户只需授权一次。

---

现在当 feishu_task_task.create 触发授权时，getToolFamilyScopes 会收集：

feishu_task_* 的所有 scope（task:task:write, task:task:read 等）
feishu_calendar_* 的所有 scope（calendar:calendar:read, calendar:calendar.event:create 等）
feishu_search_* 的所有 scope（contact:user:search）
这样一次授权就包含了 task + calendar + search 三个族的权限，不会再出现第二次授权弹窗。

同样，当 calendar 工具触发授权时，也会自动带上 search 的 scope。