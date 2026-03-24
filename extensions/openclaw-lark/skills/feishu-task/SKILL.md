---
name: feishu-task
description: |
  飞书任务管理工具,用于创建、查询、更新任务和清单。

  **当以下情况时使用此 Skill**:
  (1) 需要创建、查询、更新、删除任务
  (2) 需要创建、管理任务清单
  (3) 需要查看任务列表或清单内的任务
  (4) 用户提到"任务"、"待办"、"to-do"、"清单"、"task"
  (5) 需要设置任务负责人、关注人、截止时间

---

# 飞书任务管理

## 🔑 执行前权限预检

**在使用本 Skill 的任何工具之前，必须先调用 `feishu_pre_auth` 工具进行权限预检：**

```json
{
  "tool_actions": ["feishu_get_user.default", "feishu_search_user.default", "feishu_task_task.create", "feishu_task_task.get", "feishu_task_task.list", "feishu_task_task.patch", "feishu_task_task.add_members", "feishu_task_task.remove_members", "feishu_task_tasklist.create", "feishu_task_tasklist.get", "feishu_task_tasklist.list", "feishu_task_tasklist.tasks", "feishu_task_tasklist.patch", "feishu_task_tasklist.delete", "feishu_task_tasklist.add_members", "feishu_task_tasklist.remove_members", "feishu_task_comment.create", "feishu_task_comment.list", "feishu_task_comment.get", "feishu_task_subtask.create", "feishu_task_subtask.list", "feishu_calendar_event.create"]
}
```

- 如果返回 `all_authorized: true`，继续执行后续操作。
- 否则按返回结果的指引完成授权后再继续。

## 🚨 执行前必读

- ✅ **时间格式**：ISO 8601 / RFC 3339（带时区），例如 `2026-02-28T17:00:00+08:00`
- ✅ **current_user_id 强烈建议**：从消息上下文的 SenderId 获取（ou_...），工具会自动添加为 follower（如不在 members 中），确保创建者可以编辑任务
- ✅ **patch/get 必须**：task_guid
- ✅ **tasklist.tasks 必须**：tasklist_guid
- ✅ **完成任务**：completed_at = "2026-02-26 15:00:00"
- ✅ **反完成（恢复未完成）**：completed_at = "0"
- ✅ **智能日历提醒**：创建任务后必须自动同步创建日历提醒，提醒时间按阶梯规则设置（详见「智能提醒规则」）。
- ✅ **创建成功后返回链接**：优先使用工具返回结果中的 `task_url` 字段作为任务链接；如果 `task_url` 不存在，禁止拼接url，提示链接暂时没有生成，到任务中心查看。
- ✅ **创建前确认**：在调用 `feishu_task_task.create` 之前，必须先向用户发送一条确认消息，列出任务的所有关键信息（内容、负责人、截止时间、关注人），并在用户确认后再执行创建。
- ✅ **查询任务**：查询任务时，应包含当前用户作为 **负责人（assignee）** 或 **关注人（follower）** 的所有相关任务。如果 `list` 接口返回的数据量大，应确保分页查询完整，不要遗漏任务。
- ✅ **创建和查询消息返回格式**：创建任务使用的 **text格式** 返回，查询任务使用Markdown表格返回。

---

## 📋 快速索引：意图 → 工具 → 必填参数

| 用户意图 | 工具 | action | 必填参数 | 强烈建议 | 常用可选 |
|---------|------|--------|---------|---------|---------|
| 新建待办 | feishu_task_task | create | summary, due, members | current_user_id（SenderId） | description |
| 查未完成任务 | feishu_task_task | list | - | completed=false | page_size |
| 获取任务详情 | feishu_task_task | get | task_guid | - | - |
| 完成任务 | feishu_task_task | patch | task_guid, completed_at | - | - |
| 反完成任务 | feishu_task_task | patch | task_guid, completed_at="0" | - | - |
| 改截止时间 | feishu_task_task | patch | task_guid, due | - | - |
| 创建清单 | feishu_task_tasklist | create | name | - | members |
| 查看清单任务 | feishu_task_tasklist | tasks | tasklist_guid | - | completed |
| 添加清单成员 | feishu_task_tasklist | add_members | tasklist_guid, members[] | - | - |

---

## 🎯 核心约束（Schema 未透露的知识）

### 0. 创建任务前的确认机制

**⚠️ 强制流程：在调用创建接口前，必须先与用户确认信息：**

1.  **汇总信息**：列出任务标题、负责人、截止时间、关注人。
2.  **询问用户**：发送确认请求，例如：“好的，即将为您创建以下任务，请确认：...”。
3.  **等待确认**：只有在用户回复“确认”、“是的”、“好的”、“创建吧”等肯定意图后，才调用 `feishu_task_task.create`。

**确认消息示例（text）**：
> 好的，即将为您创建以下任务，请确认：
> 📋 任务：准备周会材料
> 👤 负责人：张三
> ⏰ 截止时间：2026-02-28 17:00
> 👀 关注人：李四
> 
> 是否现在创建？

### 1. 创建任务四要素追问逻辑

**⚠️ 强制约束：创建任务前必须检查以下要素，不满足则追问：**

| 要素 | 参数位置 | 缺失处理 |
|------|---------|---------|
| **任务内容** | `summary` | **必须追问** |
| **截止时间** | `due` | **必须追问** |
| **负责人** | `members` (role=assignee) | **必须追问** |
| **关注人** | `members` (role=follower) | **必须追问** |

### 2. 当前工具使用用户身份（已内置保护）

**工具使用 `user_access_token`（用户身份）**

这意味着：
- ✅ 创建任务时可以指定任意成员（包括只分配给别人）
- ⚠️ 只能查看和编辑**自己是成员的任务**
- ⚠️ **如果创建时没把自己加入成员，后续无法编辑该任务**

**自动保护机制**：
- 传入 `current_user_id` 参数（从 SenderId 获取）
- 如果 `members` 中不包含 `current_user_id`，工具会**自动添加为 follower**
- 确保创建者始终可以编辑任务

**推荐用法**：创建任务时始终传 `current_user_id`，工具会自动处理成员关系。

### 3. 任务成员的角色说明

- **assignee（负责人）**：负责完成任务，可以编辑任务
- **follower（关注人）**：关注任务进展，接收通知

**添加成员示例**：
```json
{
  "members": [
    {"id": "ou_xxx", "role": "assignee"},  // 负责人
    {"id": "ou_yyy", "role": "follower"}   // 关注人
  ]
}
```

**说明**：`id` 使用用户的 `open_id`（从消息上下文的 SenderId 获取）

### 4. 任务清单角色冲突

**现象**：创建清单（`tasklist.create`）时传了 `members`，但返回的 `tasklist.members` 为空或缺少成员

**原因**：创建人自动成为清单 **owner**（所有者），如果 `members` 中包含创建人，该用户最终成为 owner 并从 `members` 中移除（同一用户只能有一个角色）

**建议**：不要在 `members` 中包含创建人，只添加其他协作成员

### 5. completed_at 的三种用法

**1) 完成任务（设置完成时间）**：
```json
{
  "action": "patch",
  "task_guid": "xxx",
  "completed_at": "2026-02-26 15:30:00"  // 北京时间字符串
}
```

**2) 反完成（恢复未完成状态）**：
```json
{
  "action": "patch",
  "task_guid": "xxx",
  "completed_at": "0"  // 特殊值 "0" 表示反完成
}
```

**3) 毫秒时间戳**（不推荐，除非上层已严格生成）：
```json
{
  "completed_at": "1740545400000"  // 毫秒时间戳字符串
}
```

### 6. 清单成员的角色

| 成员类型 | 角色 | 说明 |
|---------|------|------|
| user（用户） | owner | 所有者，可转让所有权 |
| user（用户） | editor | 可编辑，可修改清单 and 任务 |
| user（用户） | viewer | 可查看，只读权限 |
| chat（群组） | editor/viewer | 整个群组获得权限 |

**说明**：创建清单时，创建者自动成为 owner，无需在 members 中指定。

---

### 7. 查询结果返回格式

**查询结果必须以 Markdown 表格格式展示，字段包含：**
- **任务标题**：summary
- **截止时间**：due（若无则显示 `-`）
- **状态**：根据 `completed_at` 和 `due` 判定（进行中 / 已完成 / 已过期）
- **负责人**：assignee 的姓名 (open_id)

**⚠️ 时间戳转换**：API 返回的 `due.timestamp`、`start.timestamp`、`completed_at` 等字段均为**毫秒时间戳字符串**（如 `"1774010400000"`，13 位数字），展示时必须转换为可读时间（北京时间 UTC+8）。毫秒时间戳 1773831600000 直接放入 new Date() = 2026-03-18 19:00。

**Markdown 表格示例**：
```text
📋 找到相关任务（共 3 项）：

| 任务标题 | 截止时间 | 状态 | 负责人 |
|---------|---------|------|-------|
| 准备周会材料 | 02-28 17:00 | 进行中 | 张三 |
| 整理需求文档 | 02-20 10:00 | 已过期 | 李四 |
| 完成代码审核 | - | 已完成 | 王五 |
```

---

## � 智能提醒规则（联动飞书日历）

创建任务成功后，**自动调用 `feishu_calendar_event.create`** 为负责人创建一条提醒日程，提醒档位如下：

| 截止时间距今 | 日程时间 | 单提醒（relative_fire_minute） | 说明 |
|-------------|---------|-------------------------------|------|
| **< 1 天** | 截止前 15 分钟，时长 15 分钟 | 15 | 临近提醒 |
| **1–2 天** | 截止前 30 分钟，时长 30 分钟 | 30 | 轻提醒 |
| **> 2 天** | 截止前 60 分钟，时长 30 分钟 | 60 | 提前提醒 |

**日历创建参数示例**：
```json
{
  "action": "create",
  "summary": "📋 任务提醒：{任务标题}",
  "start_time": "{根据规则计算的开始时间}",
  "end_time": "{start_time + 30m}",
  "reminders": [
    {"relative_fire_minute": 30}
  ],
  "attendees": [
    {"type": "user", "id": "{assignee_id}"}
  ]
}
```

---

## 📌 使用场景示例

### 场景 1: 创建任务并分配负责人（包含确认流程）

**用户输入**："帮我创建一个任务，准备周会材料，截止时间是2月28号下午5点，负责人是张三，关注人是李四"

**Step 1: 发送确认消息**
> 好的，即将为您创建以下任务，请确认：
> 📋 任务：准备周会材料
> 👤 负责人：张三
> ⏰ 截止时间：2026-02-28 17:00
> 👀 关注人：李四
> 
> 是否现在创建？

**用户确认**："确认创建"

**Step 2: 执行创建（四要素齐全）**
```json
{
  "action": "create",
  "summary": "准备周会材料",
  "due": {
    "timestamp": "2026-02-28 17:00:00",
    "is_all_day": false
  },
  "members": [
    {"id": "ou_aaa", "role": "assignee"},
    {"id": "ou_bbb", "role": "follower"}
  ]
}
```

**Step 3: 返回成功消息（必须 text 格式）**

```text
✅ 任务创建成功！

📋 任务内容：准备周会材料
👤 负责人：张三
👀 关注人：李四
⏰ 截止时间：2026-02-28 17:00
📅 已同步日历提醒（提前 30 分钟）
🔗 链接：{task_url}

（链接获取优先级：优先使用返回的 task_url 字段；若无，提示：链接生成失败，请到飞书任务里查看）
```

**⚠️ 注意：不要在返回消息中包含日历链接。** 日历日程是创建在负责人个人日历上的，其他群成员无法打开该链接。只需提示"已同步日历提醒"即可。

### 场景 2: 查询我的相关任务（包含我负责和关注的）

**用户输入**："列出我最近的所有任务"

**Step 1: 执行查询**
```json
{
  "action": "list",
  "completed": false,
  "page_size": 50
}
```

**Step 2: 返回 Markdown 表格**
```text
📋 您的相关任务（共 2 项）：

| 任务标题 | 截止时间 | 状态 | 负责人 |
|---------|---------|------|-------|
| 准备周会材料 | 02-28 17:00 | 进行中 | 张三 |
| 整理需求文档 | - | 进行中 | 李四 |
```

### 场景 3: 完成任务

```json
{
  "action": "patch",
  "task_guid": "任务的guid",
  "completed_at": "2026-02-26 15:30:00"
}
```

### 场景 4: 反完成任务（恢复未完成状态）

```json
{
  "action": "patch",
  "task_guid": "任务的guid",
  "completed_at": "0"
}
```

### 场景 5: 创建清单并添加协作者

```json
{
  "action": "create",
  "name": "产品迭代 v2.0",
  "members": [
    {"id": "ou_xxx", "role": "editor"},
    {"id": "ou_yyy", "role": "viewer"}
  ]
}
```

### 场景 6: 查看清单内的未完成任务

```json
{
  "action": "tasks",
  "tasklist_guid": "清单的guid",
  "completed": false
}
```

### 场景 7: 全天任务

```json
{
  "action": "create",
  "summary": "年度总结",
  "due": {
    "timestamp": "2026-03-01 00:00:00",
    "is_all_day": true
  }
}
```

---

## 🔍 常见错误与排查

| 错误现象 | 根本原因 | 解决方案 |
|---------|---------|---------|
| **创建后无法编辑任务** | 创建时未将自己加入 members | 创建时至少将当前用户（SenderId）加为 assignee 或 follower |
| **patch 失败提示 task_guid 缺失** | 未传 task_guid 参数 | patch/get 必须传 task_guid |
| **tasks 失败提示 tasklist_guid 缺失** | 未传 tasklist_guid 参数 | tasklist.tasks action 必须传 tasklist_guid |
| **反完成失败** | completed_at 格式错误 | 使用 `"0"` 字符串，不是数字 0 |
| **时间不对** | 使用了 Unix 时间戳 | 改用 ISO 8601 格式（带时区）：`2024-01-01T00:00:00+08:00` |

---

## 📚 附录：背景知识

### A. 资源关系

```
任务清单（Tasklist）
  └─ 自定义分组（Section，可选）
      └─ 任务（Task）
          ├─ 成员：负责人（assignee）、关注人（follower）
          ├─ 子任务（Subtask）
          ├─ 截止时间（due）、开始时间（start）
          └─ 附件、评论
```

**核心概念**：
- **任务（Task）**：独立的待办事项，有唯一的 `task_guid`
- **清单（Tasklist）**：组织多个任务的容器，有唯一的 `tasklist_guid`
- **负责人（assignee）**：可以编辑任务并标记完成
- **关注人（follower）**：接收任务更新通知
- **我负责的（MyTasks）**：所有负责人为自己的任务集合

### B. 如何将任务加入清单

创建任务时指定 `tasklists` 参数：
```json
{
  "action": "create",
  "summary": "任务标题",
  "tasklists": [
    {
      "tasklist_guid": "清单的guid",
      "section_guid": "分组的guid（可选）"
    }：:
  ]
}
```

### C. 重复任务如何创建

使用 `repeat_rule` 参数，采用 RRULE 格式：
```json
{
  "action": "create",
  "summary": "每周例会",
  "due": {"timestamp": "2026-03-03 14:00:00", "is_all_day": false},
  "repeat_rule": "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO"
}
```

**说明**：只有设置了截止时间的任务才能设置重复规则。


### D. 数据权限

- 只能操作自己有权限的任务（作为成员的任务）
- 只能操作自己有权限的清单（作为成员的清单）
- 将任务加入清单需要同时拥有任务和清单的编辑权限