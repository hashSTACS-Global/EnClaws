---
name: feishu-calendar
description: |
  飞书日历与日程管理工具集。包含日历管理、日程管理、参会人管理、忙闲查询。
---

# 飞书日历管理 (feishu-calendar)

## 🔑 执行前权限预检

**在使用本 Skill 的任何工具之前，必须先调用 `feishu_pre_auth` 工具进行权限预检：**

```json
{
  "tool_actions": ["feishu_get_user.default", "feishu_search_user.default", "feishu_calendar_calendar.list", "feishu_calendar_calendar.get", "feishu_calendar_calendar.primary", "feishu_calendar_event.create", "feishu_calendar_event.list", "feishu_calendar_event.get", "feishu_calendar_event.patch", "feishu_calendar_event.delete", "feishu_calendar_event.search", "feishu_calendar_event.reply", "feishu_calendar_event.instances", "feishu_calendar_event.instance_view", "feishu_calendar_event_attendee.create", "feishu_calendar_event_attendee.list", "feishu_calendar_event_attendee.batch_delete", "feishu_calendar_freebusy.list"]
}
```

- 如果返回 `all_authorized: true`，继续执行后续操作。
- 否则按返回结果的指引完成授权后再继续。

## 🚨 执行前必读

- ✅ **时区固定**：Asia/Shanghai（UTC+8）
- ✅ **时间格式**：ISO 8601 / RFC 3339（带时区），例如 `2026-02-25T14:00:00+08:00`
- ✅ **create 最小必填**：summary, start_time, end_time
- ✅ **create 必须追问**：用户未提供 **会议内容（summary）、时间、参会人** 中任意一项时，**必须追问补齐后再调用接口**，不得用默认值代替
- ✅ **视频会议链接获取**：优先使用返回结果中的 `vchat.meeting_url` 字段；如果 `create` 返回中没有该字段，**必须**紧接着用 `event_id` 调用 `feishu_calendar_event.get` 接口查询详情以补齐链接；如果 `get` 返回中仍无，尝试 `vchat.join_url`；若均无，提示用户到飞书日历中查看
- ✅ **user_open_id 强烈建议**：从 SenderId 获取（ou_xxx），确保用户能看到日程
- ✅ **ID 格式约定**：用户 `ou_...`，群 `oc_...`，会议室 `omm_...`，邮箱 `email@...`
- ✅ **自动添加发起人**：创建会议时，必须自动将会议发起人（从消息上下文获取的 `SenderId`）加入到 `attendees` 参会人列表中，确保发起人日程同步且可见
- ✅ **智能提醒**：创建日程时自动设置合理的提醒时间（详见「智能提醒规则」）
- ✅ **返回消息格式**：创建会议使用 **text 格式** 返回，查询日程列表使用 **Markdown 表格** 返回
- ❌ **禁止返回日历链接**：创建会议成功后，返回内容中**绝对禁止**包含任何日历链接（包括 `app_link`、`https://applink.feishu.cn/client/calendar/event/detail?calendarId=...` 等）。日程创建在用户个人日历上，其他群成员无法打开该链接。会议相关链接**只允许**使用 `vchat.meeting_url`（视频会议链接），其他人可以通过视频会议链接入会

---

## 📋 快速索引：意图 → 工具 → 必填参数

| 用户意图 | 工具 | action | 必填参数 | 强烈建议 | 常用可选 |
|---------|------|--------|---------|---------|---------|
| 创建会议 | feishu_calendar_event | create | summary, start_time, end_time | user_open_id | attendees, description, location, reminders, **recurrence** |
| 获取日程详情 | feishu_calendar_event | get | event_id | - | - |
| 查某时间段日程 | feishu_calendar_event | list | start_time, end_time | - | - |
| 改日程时间 | feishu_calendar_event | patch | event_id, start_time/end_time | - | summary, description |
| 搜关键词找会 | feishu_calendar_event | search | query | - | - |
| 回复邀请 | feishu_calendar_event | reply | event_id, rsvp_status | - | - |
| 查重复日程实例 | feishu_calendar_event | instances | event_id, start_time, end_time | - | - |
| 查忙闲 | feishu_calendar_freebusy | list | time_min, time_max, user_ids[] | - | - |
| 邀请参会人 | feishu_calendar_event_attendee | create | calendar_id, event_id, attendees[] | - | - |
| 删除参会人 | feishu_calendar_event_attendee | batch_delete | calendar_id, event_id, user_open_ids[] | - | - |

---

## 🎯 核心约束（Schema 未透露的知识）

### 0. 视频会议链接获取规则

**获取视频会议链接的优先级：**

1. **优先使用 `create` 返回值**：检查 `create` 返回结果中是否包含 `vchat.meeting_url`，如果有则直接使用。
2. **降级调用 `get` 补齐**：如果 `create` 返回中无 `vchat.meeting_url`，则用返回的 `event_id` 立即调用 `feishu_calendar_event.get`，从详情中提取 `vchat.meeting_url`。
3. **再降级**：如果 `get` 返回中 `vchat.meeting_url` 仍缺失，尝试 `vchat.join_url`。
4. **兜底提示**：若以上字段均无，告知用户”链接生成失败，请到飞书日历中查看”。

**原因**：`create` 接口可能因视频会议资源的异步创建而不包含 `vchat` 信息，需要通过 `get` 接口补齐。

### 1. 创建会议：必须三要素齐全 + 默认视频会议

**⚠️ 创建前必须检查用户是否提供了以下三项，缺一不可：**

| 要素 | 说明 | 缺失时处理 |
|------|------|-----------|
| **会议内容**（summary） | 会议主题/标题 | 追问："请问会议主题是什么？" |
| **时间**（start_time + end_time） | 开始和结束时间 | 追问："请问会议安排在什么时间？" |
| **参会人**（attendees） | 至少包含发起人和其他受邀者 | 追问："请问需要邀请哪些人参加？" |

**自动添加发起人**：在调用 `feishu_calendar_event.create` 时，必须将当前用户（从 `SenderId` 获取的 `ou_xxx`）作为 `type: "user"` 的对象加入到 `attendees` 数组中。

**周期性会议识别**：若用户提到“每天”、“每周”、“工作日”等，应自动根据规则填充 `recurrence` 字段，无需额外追问，但在最终确认时应明确告知用户重复周期。

**可一次性追问所有缺失项，避免多轮对话。**

**默认视频会议**：创建会议时强制使用以下参数，参数示例：
```json
{
  "vc_type": "vc",
  "need_notification": true
}
```

API 返回的 `vchat` 字段中包含视频会议链接（`meeting_url`），格式如：`https://vc.feishu.cn/j/327659381`

### 1. user_open_id 为什么必填？

**工具使用用户身份**：日程创建在用户主日历上，用户本人能看到。

**但为什么还要传 user_open_id**：将发起人也添加为**参会人**，确保：
- ✅ 发起人会收到日程通知
- ✅ 发起人可以回复 RSVP 状态（接受/拒绝/待定）
- ✅ 发起人出现在参会人列表中
- ✅ 其他参会人能看到发起人

**如果不传**：
- ⚠️ 用户能看到日程，但不会作为参会人
- ⚠️ 如果只有其他参会人，发起人不在列表中（不符合常规逻辑）

### 2. 参会人权限（attendee_ability）

工具已默认设置 `attendee_ability: "can_modify_event"`，参会人可以编辑日程和管理参与者。

| 权限值 | 能力 |
|--------|------|
| `none` | 无权限 |
| `can_see_others` | 可查看参与人列表 |
| `can_invite_others` | 可邀请他人 |
| `can_modify_event` | 可编辑日程（推荐） |

### 3. 统一使用 open_id（ou_...格式）

- ✅ 创建日程：`user_open_id = SenderId`
- ✅ 邀请参会人：`attendees[].id = "ou_xxx"`
- ✅ 删除参会人：`user_open_ids = ["ou_xxx"]`（工具已优化，直接传 open_id 即可）

⚠️ **ID 格式区分**：
- `ou_xxx`：用户的 open_id（**你应该使用的**）
- `user_xxx`：日程内部的 attendee_id（list 接口返回，仅用于内部记录）

### 4. 会议室预约是异步流程

添加会议室类型参会人后，会议室进入异步预约流程：
1. API 返回成功 → `rsvp_status: "needs_action"`（预约中）
2. 后台异步处理
3. 最终状态：`accept`（成功）或 `decline`（失败）

**查询预约结果**：使用 `feishu_calendar_event_attendee.list` 查看 `rsvp_status`。

### 5. 周期性会议设置 (Recurrence)

**⚠️ 周期性需求识别**：当用户提到“每天”、“每周”、“每隔 X 天”、“每月”等词汇时，必须识别为周期性会议，并使用 `recurrence` 字段。

**RRULE 规则说明**：`recurrence` 是一个字符串数组，采用 [RFC 5545 (iCalendar)](https://tools.ietf.org/html/rfc5545) 标准。

| 场景 | `recurrence` 参数示例 | 说明 |
|------|----------------------|------|
| **每天** | `["FREQ=DAILY;INTERVAL=1"]` | 每天同一时间举行 |
| **每周 (周一)** | `["FREQ=WEEKLY;INTERVAL=1;BYDAY=MO"]` | 每周一举行 |
| **每工作日 (周一至周五)** | `["FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR"]` | 典型早会场景 |
| **每两周 (周三)** | `["FREQ=WEEKLY;INTERVAL=2;BYDAY=WE"]` | 双周会场景 |
| **每月 (第 1 个周一)** | `["FREQ=MONTHLY;INTERVAL=1;BYDAY=1MO"]` | 月度会议场景 |
| **设置结束时间** | `["FREQ=DAILY;UNTIL=20261231T235959Z"]` | 截止到 2026 年底 |
| **设置次数** | `["FREQ=DAILY;COUNT=10"]` | 共举行 10 次 |

**注意事项**：
1.  **时区一致性**：`UNTIL` 时间建议使用 UTC 格式（以 `Z` 结尾），或与 `start_time` 保持一致。
2.  **默认无限重复**：若用户未指定结束时间或次数，飞书默认会持续创建该日程（通常最多显示到未来一两年）。
3.  **识别关键词**：
    *   “每天” -> `FREQ=DAILY`
    *   “每周三” -> `FREQ=WEEKLY;BYDAY=WE`
    *   “工作日” -> `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`

### 6. instances action 仅对重复日程有效

**⚠️ 重要**：`instances` action **仅对重复日程有效**，必须满足：
1. event_id 必须是重复日程的 ID（该日程具有 `recurrence` 字段）
2. 如果对普通日程调用，会返回错误

**如何判断**：
1. 先用 `get` action 获取日程详情
2. 检查返回值中是否有 `recurrence` 字段且不为空
3. 如果有，则可以调用 `instances` 获取实例列表

### 6. 智能提醒规则

创建日程时根据会议时间**自动设置提醒**，无需用户指定（用户主动指定时以用户为准）：

| 会议开始时间 | 默认提醒 | 说明 |
|-------------|---------|------|
| **30 分钟内**（紧急会议） | 5 分钟前 | 即将开始，立即提醒 |
| **当天稍后**（今天的会议） | 15 分钟前 | 留出准备时间 |
| **明天** | 15 分钟前 | 标准提醒 |
| **2-7 天后** | 1 小时前 + 15 分钟前 | 双重提醒防遗忘 |
| **7 天以上** | 1 天前 + 15 分钟前 | 提前一天 + 会前提醒 |

参数示例（单位为分钟）：
```json
{
  "reminders": [60, 15]
}
```

---

## 📌 创建成功后的返回消息格式

创建会议成功后，**必须**向用户返回以下信息，默认使用 **text** 格式：

### text 格式（默认，注意参会人格式）

```
✅ 会议创建成功

📋 会议主题：项目复盘会议
🕐 会议时间：2026-02-25 14:00 ~ 15:30
👥 参会人：张三, 李四
🔗 视频会议：https://vc.feishu.cn/j/327659381
🔔 提醒：会议前 15 分钟通知

会议已添加到参会人的飞书日历中，到时点击链接即可入会
```

**⚠️ 绝对禁止在返回消息中包含日历链接（`https://applink.feishu.cn/client/calendar/event/detail?...`）。** 日程是创建在用户个人日历上的，群内其他成员无法打开。只返回视频会议链接（`vchat.meeting_url`）。

（视频会议链接获取优先级：create 返回的 vchat.meeting_url → get 补齐的 vchat.meeting_url → vchat.join_url → 兜底提示：链接生成失败，请到飞书日历中查看）

---

## 📌 查询结果返回格式

查询日程（`list` / `search`）结果必须以 **Markdown 表格格式** 展示，字段包含：
- **日程主题**：summary
- **时间**：start_time ~ end_time（格式：MM-DD HH:mm）
- **状态**：根据当前时间判定（即将开始 / 进行中 / 已结束）
- **视频会议**：如果日程包含 `vchat.meeting_url`，展示会议链接；否则显示 `-`

**Markdown 表格示例**：
```text
📅 您的日程（共 3 项）：

| 日程主题 | 时间 | 状态 | 视频会议 |
|---------|------|------|---------|
| 项目复盘会议 | 03-19 14:00 ~ 15:30 | 即将开始 | https://vc.feishu.cn/j/327659381 |
| 部门周会 | 03-20 10:00 ~ 11:00 | - | https://vc.feishu.cn/j/438770492 |
| 1v1 面谈 | 03-21 09:00 ~ 09:30 | - | - |
```

**获取日程详情（`get`）返回格式**：
```text
📅 日程详情

📋 主题：项目复盘会议
🕐 时间：2026-03-19 14:00 ~ 15:30
📍 地点：会议室 A
👥 参会人：张三, 李四, 王五
🔗 视频会议：https://vc.feishu.cn/j/327659381
📝 描述：讨论 Q1 项目进展
```

**视频会议链接获取**：优先取 `vchat.meeting_url`，其次 `vchat.join_url`，均无则显示 `-`。

---

## 📌 其他使用场景示例

### 场景 1: 创建视频会议并邀请参会人 (Create + Get 组合示例)

**Step 1: Create**
```json
{
  "action": "create",
  "summary": "项目复盘会议",
  "description": "讨论 Q1 项目进展",
  "start_time": "2026-02-25 14:00:00",
  "end_time": "2026-02-25 15:30:00",
  "user_open_id": "ou_aaa",
  "vc_type": "vc",
  "need_notification": true,
  "reminders": [60, 15],
  "attendees": [
    {"type": "user", "id": "ou_bbb"},
    {"type": "user", "id": "ou_ccc"}
  ]
}
```

**Step 2: Get (获取会议链接)**
```json
{
  "action": "get",
  "event_id": "从 Step 1 获取的 event_id"
}
```

**返回消息 (text 格式)**:
```text
✅ 会议创建成功

📋 会议主题：项目复盘会议
🕐 会议时间：2026-02-25 14:00 ~ 15:30
👥 参会人：张三, 李四
🔗 视频会议：https://vc.feishu.cn/j/327659381
🔔 提醒：会议前 15 分钟通知

会议已添加到参会人的飞书日历中，到时点击链接即可入会
```

### 场景 2: 创建每周一举行的部门周会 (周期性会议)

**用户输入**：“帮我创建一个部门周会，每周一早上 10 点，持续 1 小时，邀请张三和李四，并开启视频会议。”

**Step 1: Create**
```json
{
  "action": "create",
  "summary": "部门周会",
  "start_time": "2026-03-23 10:00:00",
  "end_time": "2026-03-23 11:00:00",
  "user_open_id": "ou_aaa",
  "vc_type": "vc",
  "recurrence": ["FREQ=WEEKLY;INTERVAL=1;BYDAY=MO"],
  "attendees": [
    {"type": "user", "id": "ou_aaa"},
    {"type": "user", "id": "ou_bbb"},
    {"type": "user", "id": "ou_ccc"}
  ]
}
```

**Step 2: Get (获取会议链接)**
```json
{
  "action": "get",
  "event_id": "从 Step 1 获取的 event_id"
}
```

**返回消息 (text 格式)**:
```text
✅ 周期性会议创建成功

📋 会议主题：部门周会
🕐 会议时间：每周一 10:00 ~ 11:00
🔁 重复周期：每周
👥 参会人：张三, 李四
🔗 视频会议：https://vc.feishu.cn/j/327659381
🔔 提醒：会议前 15 分钟通知

会议已添加到参会人的飞书日历中，到时点击链接即可入会
```

### 场景 3: 查询用户未来一周的日程

```json
{
  "action": "list",
  "start_time": "2026-02-25 00:00:00",
  "end_time": "2026-03-03 23:59:00"
}
```

### 场景 4: 查看多个用户的忙闲时间

```json
{
  "action": "list",
  "time_min": "2026-02-25 09:00:00",
  "time_max": "2026-02-25 18:00:00",
  "user_ids": ["ou_aaa", "ou_bbb", "ou_ccc"]
}
```

**注意**：user_ids 是数组，支持 1-10 个用户。当前不支持会议室忙闲查询。

### 场景 5: 修改日程时间

```json
{
  "action": "patch",
  "event_id": "xxx_0",
  "start_time": "2026-02-25 15:00:00",
  "end_time": "2026-02-25 16:00:00"
}
```

### 场景 6: 搜索日程（按关键词）

```json
{
  "action": "search",
  "query": "项目复盘"
}
```

### 场景 7: 回复日程邀请

```json
{
  "action": "reply",
  "event_id": "xxx_0",
  "rsvp_status": "accept"
}
```

---

## 🔍 常见错误与排查

| 错误现象 | 根本原因 | 解决方案 |
|---------|---------|---------|
| **发起人不在参会人列表中** | 未传 `user_open_id` | 强烈建议传 `user_open_id = SenderId` |
| **参会人看不到其他参会人** | `attendee_ability` 权限不足 | 工具已默认设置 `can_modify_event` |
| **时间不对** | 使用了 Unix 时间戳 | 改用 ISO 8601 格式（带时区）：`2024-01-01T00:00:00+08:00` |
| **会议室显示"预约中"** | 会议室预约是异步的 | 等待几秒后用 `list` 查询 `rsvp_status` |
| **修改日程报权限错误** | 当前用户不是组织者，且日程未设置可编辑权限 | 确保日程创建时设置了 `attendee_ability: "can_modify_event"` |
| **无法查看参会人列表** | 当前用户无查看权限 | 确保是组织者或日程设置了 `can_see_others` 以上权限 |
| **返回消息中缺少会议链接** | `create` 接口可能不包含 `vchat.meeting_url` | 优先用 `create` 返回的 `vchat.meeting_url`；若无则用 `event_id` 调用 `get` 补齐；再无则尝试 `vchat.join_url` |
| **用户信息不全就创建了会议** | 未检查三要素 | 创建前必须确认 summary、时间、参会人齐全 |

---

## 📚 附录：背景知识

### A. 日历架构模型

飞书日历采用 **三层架构**：
```
日历（Calendar）
  └── 日程（Event）
       └── 参会人（Attendee）
```

**关键理解**：
1. **用户主日历**：日程创建在发起用户的主日历上，用户本人能看到
2. **参会人机制**：通过添加参会人（attendee），让其他人的日历中也显示此日程
3. **权限模型**：日程的 `attendee_ability` 参数控制参会人能否编辑日程、邀请他人、查看参与人列表

### B. 参会人类型

- `type: "user"` + `id: "ou_xxx"` — 飞书用户（使用 open_id）
- `type: "chat"` + `id: "oc_xxx"` — 飞书群组
- `type: "resource"` + `id: "omm_xxx"` — 会议室
- `type: "third_party"` + `id: "email@example.com"` — 外部邮箱

### C. 日程的生命周期

1. **创建**：在用户主日历上创建日程（工具使用用户身份）
2. **邀请参会人**：通过 attendee API 将日程分享给其他参会人
3. **参会人回复**：参会人可以 accept/decline/tentative
4. **修改**：组织者或有权限的参会人可以修改
5. **删除**：删除后状态变为 `cancelled`

### D. 日历类型说明

| 类型 | 说明 | 能否删除 | 能否修改 |
|------|------|---------|---------|
| `primary` | 主日历（每个用户/应用一个） | ❌ 否 | ✅ 是 |
| `shared` | 共享日历（用户创建并共享） | ✅ 是 | ✅ 是 |
| `resource` | 会议室日历 | ❌ 否 | ❌ 否 |
| `google` | 绑定的 Google 日历 | ❌ 否 | ❌ 否 |
| `exchange` | 绑定的 Exchange 日历 | ❌ 否 | ❌ 否 |

### E. 回复状态（rsvp_status）说明

| 状态 | 含义（用户） | 含义（会议室） |
|------|------------|---------------|
| `needs_action` | 未回复 | 预约中 |
| `accept` | 已接受 | 预约成功 |
| `tentative` | 待定 | - |
| `decline` | 拒绝 | 预约失败 |
| `removed` | 已被移除 | 已被移除 |


### F. 使用限制（来自飞书 OAPI 文档）

1. **每个日程最多 3000 名参会人**
2. **单次添加参会人上限**：
   - 用户类参会人：1000 人
   - 会议室：100 个
3. **主日历不可删除**（type 为 primary 的日历）
4. **会议室预约可能失败**：
   - 时间冲突
   - 无预约权限
   - 会议室配置限制