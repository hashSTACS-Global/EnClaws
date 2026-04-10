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
import { createChannelApp, updateChannelApp } from "../../db/models/tenant-channel-app.js";
import { createTenantModel } from "../../db/models/tenant-model.js";
import { createTenantAgent } from "../../db/models/tenant-agent.js";
import { createAuditLog } from "../../db/models/audit-log.js";
import { invalidateTenantConfigCache } from "../../config/tenant-config.js";
import { syncIdentityFile, removeIdentityFile } from "./tenant-agents-api.js";
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

    const { channel, model, sharedModel, agent } = params as {
      channel?: {
        channelType: string;
        channelName?: string;
        config?: Record<string, unknown>;
      };
      model?: {
        providerType: string;
        providerName: string;
        apiProtocol: string;
        apiKeyEncrypted: string;
        baseUrl?: string;
        models?: Array<{ id: string; name: string }>;
      };
      sharedModel?: {
        providerId: string;
        modelId: string;
      };
      agent: {
        agentId: string;
        name: string;
        config?: Record<string, unknown>;
      };
    };

    // Validate: either model or sharedModel must be provided
    if (!sharedModel && (!model || !model.providerType || !model.apiKeyEncrypted)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Model configuration is required"));
      return;
    }
    if (!agent || !agent.agentId || !agent.name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Agent configuration is required"));
      return;
    }

    let identitySynced = false;
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
          const userConfig = (channel.config ?? {}) as Record<string, unknown>;
          const appId = (userConfig.appId as string) ?? "";
          const appSecret = (userConfig.appSecret as string) ?? "";
          const defaultConfig = {
            enabled: true,
            appId,
            appSecret,
            domain: channel.channelType,
            connectionMode: "websocket",
            requireMention: true,
            dmPolicy: "open",
            groupPolicy: "open",
            allowFrom: ["*"],
            groupAllowFrom: [],
            replyMode: { group: "streaming", direct: "streaming", default: "auto" },
            uat: { ownerOnly: false, appRoleAuth: true, accessLevel: 1, autoOnboarding: true },
            streaming: true,
            ...userConfig,
          };
          channelResult = await createTenantChannel({
            tenantId: ctx.tenantId,
            channelType: channel.channelType,
            channelName: channel.channelName ?? channel.channelType,
            config: defaultConfig as any,
            createdBy: ctx.userId,
          });
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

        // 2. Create model or use shared model
        let modelProviderId: string;
        let modelModelId: string;
        let modelResult: Awaited<ReturnType<typeof createTenantModel>> | null = null;

        if (sharedModel) {
          // Use existing shared model directly
          modelProviderId = sharedModel.providerId;
          modelModelId = sharedModel.modelId;
        } else {
          modelResult = await createTenantModel({
            tenantId: ctx.tenantId,
            providerType: model!.providerType,
            providerName: model!.providerName,
            apiProtocol: model!.apiProtocol as any,
            apiKeyEncrypted: model!.apiKeyEncrypted,
            baseUrl: model!.baseUrl,
            models: model!.models ?? [],
            createdBy: ctx.userId,
          });
          modelProviderId = modelResult.id;
          modelModelId = (model!.models && model!.models.length > 0) ? model!.models[0].id : "default";
        }

        // 3. Create agent (bind model + channel app)
        const agentQuota = await checkTenantQuota(ctx.tenantId, "agents");
        if (!agentQuota.allowed) {
          throw new Error(`Agent quota reached (${agentQuota.current}/${agentQuota.max})`);
        }

        const modelConfig: ModelConfigEntry[] = [{
          providerId: modelProviderId,
          modelId: modelModelId,
          isDefault: true,
        }];

        const agentResult = await createTenantAgent({
          tenantId: ctx.tenantId,
          agentId: agent.agentId,
          name: agent.name,
          config: agent.config ?? {},
          modelConfig,
          createdBy: ctx.userId,
        });

        // Sync systemPrompt to IDENTITY.md on disk (parity with tenant.agents.create).
        // Tracked so we can roll back the file write if the transaction later fails.
        await syncIdentityFile(ctx.tenantId, agent.agentId, agent.config);
        identitySynced = true;

        // Bind agent to channel app if both were created
        if (channelAppResult && agentResult) {
          await updateChannelApp(channelAppResult.id, ctx.tenantId, { agentId: agent.agentId });
        }

        return { channel: channelResult, channelApp: channelAppResult, model: modelResult, modelProviderId, modelModelId, agent: agentResult };
      });

      // Audit log
      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: "tenant.onboarding.setup",
        detail: {
          channel: result.channel?.id ?? null,
          model: result.model?.id ?? result.modelProviderId,
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
        model: result.model
          ? { id: result.model.id, providerName: result.model.providerName }
          : { id: result.modelProviderId, shared: true },
        agent: { id: result.agent.id, agentId: result.agent.agentId, name: result.agent.name },
      });
    } catch (err) {
      // Roll back IDENTITY.md if it was written before the transaction failed.
      if (identitySynced) {
        await removeIdentityFile(ctx.tenantId, agent.agentId).catch(() => {});
      }
      const msg = err instanceof Error ? err.message : "Onboarding setup failed";
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, msg));
    }
  },
};
