/**
 * Gateway RPC handler for tenant onboarding setup.
 *
 * Methods:
 *   tenant.onboarding.setup - Create channel + model + agent in one transaction
 */

import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { isDbInitialized, withTransaction } from "../../db/index.js";
import { assertPermission, RbacError } from "../../auth/rbac.js";
import type { TenantContext } from "../../auth/middleware.js";
import { checkTenantQuota } from "../../db/models/tenant.js";
import { createTenantChannel } from "../../db/models/tenant-channel.js";
import { createChannelApp } from "../../db/models/tenant-channel-app.js";
import { createTenantModel } from "../../db/models/tenant-model.js";
import { createTenantAgent } from "../../db/models/tenant-agent.js";
import { createAuditLog } from "../../db/models/audit-log.js";
import { invalidateTenantConfigCache } from "../../config/tenant-config.js";
import type { ModelConfigEntry } from "../../db/types.js";

function getTenantCtx(
  client: GatewayRequestHandlerOptions["client"],
  respond: GatewayRequestHandlerOptions["respond"],
): TenantContext | null {
  if (!isDbInitialized()) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Multi-tenant mode not enabled"));
    return null;
  }
  const tenant = (client as unknown as { tenant?: TenantContext })?.tenant;
  if (!tenant) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Authentication required"));
    return null;
  }
  return tenant;
}

export const tenantOnboardingHandlers: GatewayRequestHandlers = {
  /**
   * Complete onboarding setup in a single transaction.
   *
   * Params:
   *   channel?: { channelType, channelName?, config? }
   *   model: { providerType, providerName, apiProtocol, apiKeyEncrypted, baseUrl?, models? }
   *   agent: { agentId, name, config?, systemPrompt? }
   */
  "tenant.onboarding.setup": async ({ params, client, respond, context }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;

    try {
      assertPermission(ctx.role, "agent.create");
    } catch (err) {
      if (err instanceof RbacError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      throw err;
    }

    const { channel, model, agent } = params as {
      channel?: {
        channelType: string;
        channelName?: string;
        config?: Record<string, unknown>;
      };
      model: {
        providerType: string;
        providerName: string;
        apiProtocol: string;
        apiKeyEncrypted: string;
        baseUrl?: string;
        models?: Array<{ id: string; name: string }>;
      };
      agent: {
        agentId: string;
        name: string;
        config?: Record<string, unknown>;
      };
    };

    // Validate required fields
    if (!model || !model.providerType || !model.apiKeyEncrypted) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Model configuration is required"));
      return;
    }
    if (!agent || !agent.agentId || !agent.name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Agent configuration is required"));
      return;
    }

    try {
      const result = await withTransaction(async () => {
        let channelResult = null;
        let channelAppResult = null;

        // 1. Create channel + channel app (optional)
        if (channel?.channelType) {
          const channelQuota = await checkTenantQuota(ctx.tenantId, "channels");
          if (!channelQuota.allowed) {
            throw new Error(`Channel quota reached (${channelQuota.current}/${channelQuota.max})`);
          }
          channelResult = await createTenantChannel({
            tenantId: ctx.tenantId,
            channelType: channel.channelType,
            channelName: channel.channelName,
            config: channel.config as any,
            createdBy: ctx.userId,
          });

          // Create channel app with appId/appSecret
          const appId = (channel.config as Record<string, unknown>)?.appId as string | undefined;
          const appSecret = (channel.config as Record<string, unknown>)?.appSecret as string | undefined;
          if (appId) {
            channelAppResult = await createChannelApp({
              channelId: channelResult.id,
              tenantId: ctx.tenantId,
              appId,
              appSecret: appSecret ?? "",
              botName: agent.name,
            });
          }
        }

        // 2. Create model
        const modelResult = await createTenantModel({
          tenantId: ctx.tenantId,
          providerType: model.providerType,
          providerName: model.providerName,
          apiProtocol: model.apiProtocol as any,
          apiKeyEncrypted: model.apiKeyEncrypted,
          baseUrl: model.baseUrl,
          models: model.models ?? [],
          createdBy: ctx.userId,
        });

        // 3. Create agent (bind model + channel app)
        const agentQuota = await checkTenantQuota(ctx.tenantId, "agents");
        if (!agentQuota.allowed) {
          throw new Error(`Agent quota reached (${agentQuota.current}/${agentQuota.max})`);
        }

        const modelConfig: ModelConfigEntry[] = [{
          providerId: modelResult.id,
          modelId: (model.models && model.models.length > 0) ? model.models[0].id : "default",
          isDefault: true,
        }];

        const agentResult = await createTenantAgent({
          tenantId: ctx.tenantId,
          agentId: agent.agentId,
          name: agent.name,
          config: agent.config ?? {},
          channelAppId: channelAppResult?.id,
          modelConfig,
          createdBy: ctx.userId,
        });

        return { channel: channelResult, channelApp: channelAppResult, model: modelResult, agent: agentResult };
      });

      // Audit log
      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: "tenant.onboarding.setup",
        detail: {
          channel: result.channel?.id ?? null,
          model: result.model.id,
          agent: result.agent.id,
        },
      });

      // Invalidate config cache, reload channel config, and start channel connection
      invalidateTenantConfigCache(ctx.tenantId);
      if (result.channelApp && result.channel && context?.reloadDbChannels && context?.startChannel) {
        await context.reloadDbChannels();
        await context.startChannel(
          result.channel.channelType as any,
          result.channelApp.appId,
        );
      }

      respond(true, {
        channel: result.channel ? { id: result.channel.id, channelType: result.channel.channelType } : null,
        model: { id: result.model.id, providerName: result.model.providerName },
        agent: { id: result.agent.id, agentId: result.agent.agentId, name: result.agent.name },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Onboarding setup failed";
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, msg));
    }
  },
};
