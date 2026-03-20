/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_pre_auth tool — 技能执行前的权限预检与授权。
 *
 * 在 AI 执行某个 skill 的工具之前，先调用此工具，
 * 一次性检查并授权该 skill 涉及的所有权限（app scope + user scope）。
 * 避免工具逐个失败再逐个授权的体验问题。
 *
 * 根据 TOOL_TOKEN_TYPES 区分 token 类型：
 * - tenant 类工具：仅检查应用 scope 是否开通，不需要用户 OAuth
 * - user 类工具：检查应用 scope + 用户 OAuth 授权
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { Type } from '@sinclair/typebox';
import { getAppGrantedScopes } from '../core/app-scope-checker';
import { AppScopeCheckFailedError } from '../core/tool-client';
import { getStoredToken } from '../core/token-store';
import { getLarkAccount } from '../core/accounts';
import { getTicket } from '../core/lark-ticket';
import { LarkClient } from '../core/lark-client';
import {
  assertUatAccess,
  UatAccessDeniedError,
  UatAccessUnavailableError,
  UatIdentityRequiredError,
} from '../core/uat-access-guard';
import { executeAuthorize } from './oauth';
import { formatLarkError } from '../core/api-error';
import { TOOL_SCOPES, filterSensitiveScopes, getTokenType } from '../core/tool-scopes';
import { type ToolActionKey, getRequiredScopes, getRequiredScopesForActions } from '../core/scope-manager';
import { json } from './oapi/helpers';
import { missingScopes } from '../core/app-scope-checker';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const FeishuPreAuthSchema = Type.Object(
  {
    tool_actions: Type.Array(Type.String(), {
      description:
        '需要预检的工具动作列表，格式为 tool_name.action。' +
        '例如：["feishu_task_task.create", "feishu_task_task.list", "feishu_calendar_event.create"]',
    }),
  },
  {
    description:
      '飞书权限预检工具。在执行 Skill 前预先检查并授权所需的所有权限，' +
      '避免工具逐个调用失败再逐个授权。' +
      '【使用场景】AI 在执行 SKILL.md 中声明了 required_tool_actions 的技能前自动调用。',
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 校验字符串是否为合法的 ToolActionKey */
const validActionKeys = new Set(Object.keys(TOOL_SCOPES));

function validateToolActions(actions: string[]): { valid: ToolActionKey[]; invalid: string[] } {
  const valid: ToolActionKey[] = [];
  const invalid: string[] = [];
  for (const a of actions) {
    if (validActionKeys.has(a)) {
      valid.push(a as ToolActionKey);
    } else {
      invalid.push(a);
    }
  }
  return { valid, invalid };
}

/**
 * 按 tokenType 分组工具动作，并收集各组所需的 scopes（去重排序）。
 */
function splitByTokenType(actions: ToolActionKey[]): {
  tenantActions: ToolActionKey[];
  userActions: ToolActionKey[];
  tenantScopes: string[];
  userScopes: string[];
} {
  const tenantActions: ToolActionKey[] = [];
  const userActions: ToolActionKey[] = [];
  const tenantScopesSet = new Set<string>();
  const userScopesSet = new Set<string>();

  for (const action of actions) {
    const tokenType = getTokenType(action);
    const scopes = getRequiredScopes(action);
    if (tokenType === 'tenant') {
      tenantActions.push(action);
      scopes.forEach((s) => tenantScopesSet.add(s));
    } else {
      userActions.push(action);
      scopes.forEach((s) => userScopesSet.add(s));
    }
  }

  return {
    tenantActions,
    userActions,
    tenantScopes: [...tenantScopesSet].sort(),
    userScopes: [...userScopesSet].sort(),
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerFeishuPreAuthTool(api: OpenClawPluginApi): void {
  if (!api.config) return;

  const cfg = api.config;

  api.registerTool(
    {
      name: 'feishu_pre_auth',
      label: 'Feishu: Pre-Authorization Check',
      description:
        '飞书权限预检工具，在执行 Skill 前一次性检查并授权所需的所有权限。' +
        'AI 在执行含 required_tool_actions 的技能时自动调用。',
      parameters: FeishuPreAuthSchema,

      async execute(_toolCallId: string, params: unknown) {
        const p = params as { tool_actions: string[] };
        try {
          // 0. 基础校验
          const ticket = getTicket();
          const senderOpenId = ticket?.senderOpenId;
          if (!senderOpenId) {
            return json({
              error: '无法获取当前用户身份（senderOpenId），请在飞书对话中使用此工具。',
            });
          }

          const acct = getLarkAccount(cfg, ticket.accountId);
          if (!acct.configured) {
            return json({
              error: `账号 ${ticket.accountId} 缺少 appId 或 appSecret 配置`,
            });
          }
          const account = acct;
          const { appId } = account;
          const sdk = LarkClient.fromAccount(account).sdk;

          // 1. 校验 tool action keys
          const { valid: validActions, invalid: invalidActions } = validateToolActions(p.tool_actions);
          if (validActions.length === 0) {
            return json({
              error: 'tool_actions 中没有合法的工具动作',
              invalid_actions: invalidActions,
            });
          }

          // 2. 按 tokenType 分组
          const { tenantActions, userActions, tenantScopes, userScopes } = splitByTokenType(validActions);
          const allScopes = getRequiredScopesForActions(validActions);

          if (allScopes.length === 0) {
            return json({
              all_authorized: true,
              message: '所有工具动作不需要额外权限，可以继续执行。',
              total_actions: validActions.length,
              ...(invalidActions.length > 0 ? { warnings: { unknown_actions: invalidActions } } : {}),
            });
          }

          // 3. 检查应用权限（App Granted Scopes）
          //    tenant 和 user 类工具都需要应用先开通 scope
          //    user 类工具额外需要 offline_access（OAuth Device Flow 前提）
          const appCheckScopes = [...new Set([...allScopes, ...(userScopes.length > 0 ? ['offline_access'] : [])])];

          let appGrantedScopes: string[];
          try {
            appGrantedScopes = await getAppGrantedScopes(sdk, appId, 'user');
          } catch (err) {
            if (err instanceof AppScopeCheckFailedError) {
              return json({
                error: 'app_scope_check_failed',
                message:
                  '应用缺少核心权限 application:application:self_manage，无法查询可授权 scope 列表。\n\n' +
                  '请管理员在飞书开放平台开通此权限后重试。',
                permission_link: `https://open.feishu.cn/app/${appId}/auth?q=application:application:self_manage`,
                app_id: appId,
              });
            }
            throw err;
          }

          // 检查 app scope 缺失
          if (appGrantedScopes.length > 0) {
            const missingAppScopes = missingScopes(appGrantedScopes, appCheckScopes);
            if (missingAppScopes.length > 0) {
              const authUrl = `https://open.feishu.cn/app/${appId}/auth?q=${encodeURIComponent(missingAppScopes.join(','))}&op_from=feishu-openclaw&token_type=user`;
              return json({
                error: 'app_scope_missing',
                message:
                  `应用缺少以下权限，请管理员在飞书开放平台申请并审核通过后重试：\n\n` +
                  missingAppScopes.map((s) => `• ${s}`).join('\n'),
                missing_app_scopes: missingAppScopes,
                permission_link: authUrl,
                app_id: appId,
              });
            }
          }

          // 4. 如果没有 user 类工具，app scope 检查通过即完成
          if (userActions.length === 0) {
            return json({
              all_authorized: true,
              message: '所有权限已就绪（仅需应用权限，无需用户授权），可以继续执行。',
              total_scopes: allScopes.length,
              total_actions: validActions.length,
              tenant_actions: tenantActions.length,
              user_actions: 0,
              ...(invalidActions.length > 0 ? { warnings: { unknown_actions: invalidActions } } : {}),
            });
          }

          // 5. 检查用户权限（仅 user 类工具的 scopes 需要用户 OAuth）
          //    UAT 访问策略检查
          {
            let stateDir: string | undefined;
            try {
              stateDir = LarkClient.runtime.state.resolveStateDir();
            } catch {
              // runtime 未初始化时不阻塞
            }
            try {
              await assertUatAccess({ account, sdk, userOpenId: senderOpenId, stateDir });
            } catch (err) {
              if (
                err instanceof UatAccessDeniedError ||
                err instanceof UatAccessUnavailableError ||
                err instanceof UatIdentityRequiredError
              ) {
                return json({ error: err.message });
              }
              throw err;
            }
          }

          const existing = await getStoredToken(appId, senderOpenId);
          const grantedScopes = new Set(existing?.scope?.split(/\s+/).filter(Boolean) ?? []);

          // 只检查 user 类工具需要的 scopes
          let userMissing = userScopes.filter((s) => !grantedScopes.has(s));
          userMissing = filterSensitiveScopes(userMissing);

          if (!existing || userMissing.length > 0) {
            // 需要用户 OAuth 授权
            const scopesToAuth = existing ? userMissing : filterSensitiveScopes(userScopes);

            // 飞书限制：单次最多 100 个 scope
            const MAX_SCOPES_PER_BATCH = 100;
            let scopesBatch = scopesToAuth;
            let batchInfo = '';

            if (scopesToAuth.length > MAX_SCOPES_PER_BATCH) {
              scopesBatch = scopesToAuth.slice(0, MAX_SCOPES_PER_BATCH);
              const remaining = scopesToAuth.length - MAX_SCOPES_PER_BATCH;
              batchInfo =
                `\n\n由于飞书限制（单次最多 ${MAX_SCOPES_PER_BATCH} 个 scope），` +
                `本次将授权前 ${MAX_SCOPES_PER_BATCH} 个权限。\n` +
                `授权完成后，还需授权剩余 ${remaining} 个权限`;
            }

            const scope = scopesBatch.join(' ');
            const result = await executeAuthorize({
              account,
              senderOpenId,
              scope,
              showBatchAuthHint: true,
              cfg,
              ticket,
            });

            if (batchInfo && result.details) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const details = result.details as any;
              if (details.message) {
                details.message = details.message + batchInfo;
              }
            }

            return result;
          }

          // 6. 全部就绪
          return json({
            all_authorized: true,
            message: '所有权限已就绪，可以继续执行。',
            total_scopes: allScopes.length,
            total_actions: validActions.length,
            tenant_actions: tenantActions.length,
            user_actions: userActions.length,
            ...(invalidActions.length > 0 ? { warnings: { unknown_actions: invalidActions } } : {}),
          });
        } catch (err) {
          api.logger.error?.(`feishu_pre_auth: ${err}`);
          return json({ error: formatLarkError(err) });
        }
      },
    },
    { name: 'feishu_pre_auth' },
  );

  api.logger.info?.('feishu_pre_auth: Registered feishu_pre_auth tool');
}
