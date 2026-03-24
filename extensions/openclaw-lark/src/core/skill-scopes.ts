/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Skill Scope 注册表（自动从 SKILL.md 加载）
 *
 * 启动时扫描以下目录中的 SKILL.md，提取 tool_actions JSON 块，
 * 构建 tool_action → skill scopes 的反向索引。
 * auto-auth 在工具授权失败时按 **skill 粒度** 一次性请求所有权限。
 *
 * ## Skill 目录
 *
 * 1. 插件内置：openclaw-lark/skills/
 * 2. 租户自定义：~/.enclaws/tenants/{tenant}/skills/
 *
 * ## 新增 Skill 只需
 *
 * 1. 在上述任一目录下创建 <skill-name>/SKILL.md 并声明 tool_actions JSON 块
 * 2. 重启服务即可生效，无需修改任何代码
 *
 * 最后更新: 2026-03-23
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { type ToolActionKey, TOOL_SCOPES } from './tool-scopes';

// ===== 从 SKILL.md 动态加载 tool_actions =====

/** 插件根目录（当前文件: src/core/skill-scopes.ts → 向上两级） */
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 租户 skills 根目录：~/.enclaws/tenants/ */
const TENANT_SKILLS_ROOT = join(homedir(), '.enclaws', 'tenants');

/**
 * 收集所有需要扫描的 skills 来源。
 *
 * 返回 { dir, tenantId? } 数组：
 * - 插件内置 skill：tenantId 为 undefined
 * - 租户自定义 skill：tenantId 为租户目录名
 *
 * 后续用 tenantId 区分同名 skill 的 key：
 * - 内置：skillName（如 "feishu-calendar"）
 * - 租户：tenantId:skillName（如 "acme:feishu-calendar"）
 */
function collectSkillsSources(): { dir: string; tenantId?: string }[] {
  const sources: { dir: string; tenantId?: string }[] = [];

  // 1. 插件内置：openclaw-lark/skills/
  const builtinDir = join(PLUGIN_ROOT, 'skills');
  if (existsSync(builtinDir)) {
    sources.push({ dir: builtinDir });
  }

  // 2. 租户自定义：~/.enclaws/tenants/{tenant}/skills/
  try {
    for (const tenant of readdirSync(TENANT_SKILLS_ROOT)) {
      const tenantSkillsDir = join(TENANT_SKILLS_ROOT, tenant, 'skills');
      try {
        if (statSync(tenantSkillsDir).isDirectory()) {
          sources.push({ dir: tenantSkillsDir, tenantId: tenant });
        }
      } catch {
        // 该租户没有 skills 目录，跳过
      }
    }
  } catch {
    // 租户根目录不存在（开发环境 / Windows），跳过
  }

  return sources;
}

/** 已知的合法 tool action key 集合，用于过滤无效条目 */
const validActionKeys = new Set(Object.keys(TOOL_SCOPES));

/**
 * 从单个 SKILL.md 内容中提取 tool_actions 数组。
 *
 * 匹配 ```json 代码块中包含 "tool_actions" 键的 JSON 对象，
 * 提取其 tool_actions 数组值，并过滤掉不在 TOOL_SCOPES 中的无效条目。
 */
function extractToolActions(content: string): ToolActionKey[] {
  // 匹配 ```json ... ``` 代码块
  const jsonBlockRe = /```json\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = jsonBlockRe.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed?.tool_actions)) {
        return (parsed.tool_actions as string[]).filter((a) =>
          validActionKeys.has(a),
        ) as ToolActionKey[];
      }
    } catch {
      // 非 JSON 或格式不合法，跳过
    }
  }

  return [];
}

/**
 * 扫描所有 skills 目录，解析 SKILL.md 并构建 skill → tool_actions 映射。
 *
 * Key 命名规则：
 * - 插件内置 skill：skillName（如 "feishu-calendar"）
 * - 租户自定义 skill：tenantId:skillName（如 "acme:feishu-calendar"）
 *
 * 不同租户的同名 skill 各自独立，不会互相合并。
 */
function loadSkillToolActions(): Record<string, readonly ToolActionKey[]> {
  const result: Record<string, ToolActionKey[]> = {};

  for (const { dir: skillsDir, tenantId } of collectSkillsSources()) {
    let entries: string[];
    try {
      entries = readdirSync(skillsDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const skillDir = join(skillsDir, entry);
      try {
        if (!statSync(skillDir).isDirectory()) continue;
      } catch {
        continue;
      }

      const skillMdPath = join(skillDir, 'SKILL.md');
      let content: string;
      try {
        content = readFileSync(skillMdPath, 'utf8');
      } catch {
        continue;
      }

      const actions = extractToolActions(content);
      if (actions.length > 0) {
        const key = tenantId ? `${tenantId}:${entry}` : entry;
        result[key] = actions;
      }
    }
  }

  return result;
}

// ===== 导出数据 =====

/**
 * 每个 skill 的完整 tool_actions 列表，启动时从 SKILL.md 自动加载。
 */
export const SKILL_TOOL_ACTIONS: Record<string, readonly ToolActionKey[]> =
  loadSkillToolActions();

// ===== 反向索引：tool_action → 所属 skill 的 tool_actions（按 skill 分组） =====

/**
 * tool_action → 包含它的各个 skill 的 tool_actions 列表（不跨 skill 合并）。
 *
 * 例如 feishu_calendar_event.create 出现在 calendar 和 task 两个 skill 中，
 * 则映射为 [calendarActions[], taskActions[]]。
 */
const toolActionToSkillGroups = new Map<string, readonly ToolActionKey[][]>();

for (const actions of Object.values(SKILL_TOOL_ACTIONS)) {
  for (const action of actions) {
    const existing = toolActionToSkillGroups.get(action);
    if (existing) {
      (existing as ToolActionKey[][]).push([...actions] as ToolActionKey[]);
    } else {
      toolActionToSkillGroups.set(action, [[...actions] as ToolActionKey[]]);
    }
  }
}

/**
 * 当一个 tool_action 出现在过多 skill 中时，视为"共享工具"，
 * 无法确定当前 skill 上下文，返回空数组让 auto-auth 回退到工具族扩展。
 *
 * 阈值 3：
 * - feishu_search_user.default (6 skills) → 共享 → 回退
 * - feishu_calendar_event.create (2 skills: calendar + task) → 可确定 → 合并
 * - feishu_bitable_app.create (1 skill) → 明确 → 使用
 */
const SHARED_TOOL_THRESHOLD = 3;

/**
 * 根据单个 tool action（apiName 格式）获取其所属 skill 的所有 scope。
 *
 * 当 auto-auth 遇到 `UserAuthRequiredError` 时，用此函数替代 `getToolFamilyScopes`，
 * 一次性获取整个 skill 涉及的所有权限，避免多次弹出授权卡片。
 *
 * 策略：
 * - 该 action 仅出现在 1-2 个 skill 中 → 合并这些 skill 的全部 scope
 * - 该 action 出现在 ≥3 个 skill 中 → 视为共享工具，返回空数组，回退到工具族扩展
 *
 * @param apiName - 失败的工具 apiName（例如 "feishu_search_user.default"）
 * @returns 该 tool 所属 skill 的所有 scope（去重），如果不属于任何 skill 或为共享工具则返回空数组
 */
export function getSkillScopesForTool(apiName: string): string[] {
  const groups = toolActionToSkillGroups.get(apiName);
  if (!groups || groups.length >= SHARED_TOOL_THRESHOLD) return [];

  const allScopes = new Set<string>();
  for (const skillActions of groups) {
    for (const action of skillActions) {
      const scopes = TOOL_SCOPES[action as ToolActionKey];
      if (scopes) {
        for (const s of scopes) allScopes.add(s);
      }
    }
  }
  return [...allScopes];
}

/**
 * 根据 tool_action key 查找其所属 skill 的 tool_actions。
 *
 * 用于 before_tool_call hook 构造 blockReason，提示 AI 调用 feishu_pre_auth：
 * - 属于 1-2 个 skill → 返回合并的 tool_actions
 * - 属于 ≥3 个 skill（共享工具）或不在任何 skill 中 → 返回 undefined（放行）
 */
export function getPreAuthToolActions(apiName: string): readonly ToolActionKey[] | undefined {
  const groups = toolActionToSkillGroups.get(apiName);
  if (!groups || groups.length === 0 || groups.length >= SHARED_TOOL_THRESHOLD) return undefined;

  if (groups.length === 1) return groups[0];
  const merged = new Set<ToolActionKey>();
  for (const actions of groups) {
    for (const a of actions) merged.add(a);
  }
  return [...merged];
}

/**
 * 将一组 tool_actions 展开为其所属 skill 的全部 tool_actions。
 *
 * 用于 pre-auth 记录时：AI 预检了 skill 的 tool_actions，
 * 同一 skill 内的所有 action 都应标记为已预检，避免逐个拦截。
 *
 * 共享工具（≥3 个 skill）不展开，仅保留原始值。
 */
export function expandToSkillActions(actions: readonly string[]): string[] {
  const expanded = new Set<string>();
  for (const action of actions) {
    expanded.add(action);
    const groups = toolActionToSkillGroups.get(action);
    if (groups && groups.length < SHARED_TOOL_THRESHOLD) {
      for (const skillActions of groups) {
        for (const a of skillActions) expanded.add(a);
      }
    }
  }
  return [...expanded];
}
