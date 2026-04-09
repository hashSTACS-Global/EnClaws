# Phase 3: Scope Promotion & Rollback — 设计文档

## 概述

Phase 3 将已审核通过的企业经验知识发布到 agent 可消费的载体（tenant `MEMORY.md`），并提供单条粒度的 rollback 能力。这是经验提取流水线从"采集 → 蒸馏 → 审核"走向"发布 → 消费"的关键一步。

## 前置条件

Phase 0-2b 全部完成：
- 候选采集（capture）：per-user workspace，turn 触发
- 蒸馏（distill）：per-tenant，cron 或手动触发
- 审核（review）：approve / reject 状态变更
- 40 个单元测试 + 17 个 gateway 集成测试通过

## 设计决策

| 决策 | 结论 | 原因 |
|------|------|------|
| Scope 层级 | 两级：tenant + personal | 当前无 team 目录结构，两级足够覆盖主要场景 |
| Personal scope MVP | 仅预留字段，不实现发布 | 当前 distill 产出全是组织级知识，personal 发布留后续 |
| 发布目标 | tenant `MEMORY.md` | 已有 bootstrap 注入路径，新 session 自动加载 |
| 投影方式 | HTML 注释标记区块，全量重生成 | 幂等、不污染手写内容、rollback 简单 |
| Rollback 粒度 | 单条 supersede + 重生成标记区块 | 投影模型下不需要版本快照 |
| 新建 KNOWLEDGE.md? | 否 | agent bootstrap 和 memory_search 都不识别新文件名，改动代价高于收益 |

## 1. 数据模型变更

### DistilledRecord 新增字段

```typescript
type DistilledRecord = {
  recordId: string;
  tenantId: string;
  kind: ExperienceKind;
  summary: string;
  evidence: string[];
  sourceCandidateIds: string[];
  sourceUserIds: string[];
  status: DistilledStatus;
  createdAt: string;
  updatedAt: string;
  // Phase 3 新增
  scope: "tenant" | "personal";
  promotedAt?: string;           // ISO 时间戳，promote 时写入
  supersededBy?: string;         // rollback 时记录取代者的 recordId（可选）
};
```

### DistilledStatus 扩展

```typescript
type DistilledStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "promoted"      // Phase 3 新增状态
  | "superseded";
```

### 状态流转

```
pending_review → approved → promoted
                         ↘ rejected
promoted → superseded (rollback)
superseded → approved (重新 approve 后可再次 promote)
```

### 向后兼容

已有 distilled 记录无 `scope` 字段。读取时 fallback 为 `"tenant"`——现有 5 条 approved 记录全是组织级事实，语义一致。

## 2. Promote 流程

### 命令

```
/experience promote        → promote 所有 scope=tenant 且 status=approved 的记录
/experience promote 1,3    → promote 指定编号的 approved 记录
```

编号来源：`/experience review approved` 列出待 promote 的记录。

### 执行步骤

1. 从 distill store 加载所有 `status=approved, scope=tenant` 的记录
2. 如果指定了编号，按编号筛选
3. 将筛选出的记录 status 改为 `promoted`，写入 `promotedAt`
4. 调用 `publishPromotedToTenantMemory()` 重新生成标记区块
5. 返回 promote 结果摘要

### 边界情况

- 无 approved 记录 → 提示 "没有待发布的记录"
- 编号越界 → 提示无效编号
- `scope=personal` 的 approved 记录 → 提示 "personal scope 记录暂不支持发布"

## 3. Rollback 流程

### 命令

```
/experience rollback 2,4   → 将指定编号的 promoted 记录标记为 superseded
```

编号来源：`/experience review promoted` 列出已发布的记录。

### 执行步骤

1. 从 distill store 加载所有 `status=promoted` 的记录，按 `promotedAt` 排序
2. 按编号筛选目标记录
3. 将目标记录 status 改为 `superseded`，写入 `updatedAt`
4. 调用 `publishPromotedToTenantMemory()` 重新生成标记区块
5. 返回 rollback 结果摘要

### 恢复误操作

被 supersede 的记录可以通过 `/experience approve` 重新拉回 approved 状态，再 promote。

## 4. Publish 投影逻辑

### 新模块 `publish.ts`

核心函数 `publishPromotedToTenantMemory(params: { tenantId: string; tenantDir: string })`：

1. 读取 tenant `MEMORY.md` 全文
2. 从 distill store 加载所有 `status=promoted` 的记录
3. 按 kind 分组生成 Markdown

### 标记区块格式

```markdown
<!-- enclaws:experience:start -->
## 企业知识（自动提取）

> 以下内容由经验提取流水线自动生成，最近更新：2026-04-08 12:41

### 事实
- 公司使用 PostgreSQL 16 作为主数据库
- 生产环境部署在 AWS 东京区域的 EKS 集群

### 流程
- 每周三下午 3 点进行 PostgreSQL 全量备份
- 代码审查与 CI/CD 部署流程：提交 PR → 两位 reviewer → CI 测试 → staging → 生产

### 策略
- 每周三下午 3 点进行 PostgreSQL 全量备份
<!-- enclaws:experience:end -->
```

### Kind 到 Section 标题映射

| kind | 标题 |
|------|------|
| `fact` | 事实 |
| `workflow` | 流程 |
| `policy_hint` | 策略 |
| `preference` | 偏好 |
| `failure_pattern` | 故障模式 |
| `tool_recipe` | 工具用法 |

### 写入规则

- 已有标记区块 → 替换整个区块（start 到 end 注释之间的内容）
- 没有标记区块 → 追加到文件末尾
- promoted 记录为 0 → 移除整个标记区块（含注释标记）
- 标记区块外的手写内容 → 完全不动

### 幂等性

每次 publish 从 `status=promoted` 记录全量重生成区块。多次调用结果相同。

## 5. Distill Prompt 变更

### 新增 scope 标注指引

在 distill prompt 中追加：

```
对每条蒸馏记录，判断 scope：
- "tenant"：组织级知识，适用于所有员工和 agent（如技术栈、部署环境、团队流程、公司规范）
- "personal"：仅与特定用户相关的偏好或上下文（如个人编辑器偏好、个人任务进度）

如果无法确定，默认标注为 "tenant"。
```

### 输出格式扩展

distill LLM 的 JSON 输出中每条记录增加 `"scope": "tenant" | "personal"` 字段。

### 兼容性

解析 distill 输出时，如果 `scope` 字段缺失，fallback 为 `"tenant"`。

## 6. Review 命令扩展

### 新增子命令参数

```
/experience review              → 列出 pending_review（默认，不变）
/experience review approved     → 列出 approved 待 promote 的记录（带编号）
/experience review promoted     → 列出已 promoted 的记录（供 rollback 参考）
```

### 显示格式

列表中每条记录展示：编号、kind、summary、evidence 数量、scope。promoted 列表额外展示 promotedAt 时间。

## 7. 文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/experience/publish.ts` | 标记区块投影逻辑 |
| `src/experience/promote-command.ts` | promote / rollback 命令处理 |
| `src/experience/publish.test.ts` | publish 单元测试 |
| `src/experience/promote-command.test.ts` | promote/rollback 单元测试 |

### 改动文件

| 文件 | 改动内容 |
|------|---------|
| `src/experience/types.ts` | DistilledRecord 加 scope / promotedAt / supersededBy；DistilledStatus 加 promoted |
| `src/experience/distill.ts` | prompt 增加 scope 标注指引，解析输出增加 scope 字段 |
| `src/experience/distill-store.ts` | listDistilledRecords 支持按 status / scope 过滤 |
| `src/experience/review-command.ts` | 支持 --approved / --promoted 参数 |
| `src/experience/commands-experience.ts` | 注册 promote / rollback 子命令路由 |
| `src/experience/commands-registry.data.ts` | 更新 /experience 命令描述 |
| `src/experience/index.ts` | 导出新模块 |
| `src/experience/status-command.ts` | 状态统计加 promoted 计数 |

## 8. 测试计划

### 单元测试（新增约 15-20 个）

**publish.ts：**
- 从 promoted 记录生成 Markdown 区块
- 按 kind 正确分组和排序
- 替换已有标记区块，保留手写内容
- promoted 为 0 时移除标记区块
- MEMORY.md 不存在时创建
- 幂等性：连续两次 publish 结果相同

**promote-command.ts：**
- promote 全部 approved 记录
- promote 指定编号
- rollback 指定编号
- 边界：无记录、编号越界、personal scope 拦截
- 状态流转：approved → promoted → superseded → approved（恢复）

**distill-store.ts：**
- 按 status 过滤
- 按 scope 过滤
- 旧记录无 scope 字段 fallback

### 已有测试适配

- 现有 40 个测试中涉及 DistilledRecord fixture 的，补 `scope: "tenant"` 默认值

### 手动验证

1. 完整流程：对话 → capture → distill → review → approve → promote → 检查 tenant MEMORY.md
2. 新 session 验证：promote 后新开 session，agent 启动 bootstrap 中包含 promoted 知识
3. Rollback：rollback 一条 → MEMORY.md 区块更新 → 新 session 不再包含该条
4. 幂等性：连续两次 promote，MEMORY.md 内容不变
