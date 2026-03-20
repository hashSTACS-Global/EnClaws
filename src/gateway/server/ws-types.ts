import type { WebSocket } from "ws";
import type { ConnectParams } from "../protocol/index.js";
import type { TenantContext } from "../../auth/middleware.js";

export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  connId: string;
  presenceKey?: string;
  clientIp?: string;
  canvasHostUrl?: string;
  canvasCapability?: string;
  canvasCapabilityExpiresAtMs?: number;
  tenant?: TenantContext;
};
