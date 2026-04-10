import { connectGateway } from "./app-gateway.ts";
import {
  startLogsPolling,
  startNodesPolling,
  stopLogsPolling,
  stopNodesPolling,
  startDebugPolling,
  stopDebugPolling,
  startSandboxPolling,
  stopSandboxPolling,
} from "./app-polling.ts";
import { observeTopbar, scheduleChatScroll, scheduleLogsScroll } from "./app-scroll.ts";
import {
  applySettingsFromUrl,
  attachThemeListener,
  detachThemeListener,
  inferBasePath,
  syncTabWithLocation,
  syncThemeWithSettings,
} from "./app-settings.ts";
import { isAuthenticated } from "./auth-store.ts";
import { loadControlUiBootstrapConfig } from "./controllers/control-ui-bootstrap.ts";
import type { Tab } from "./navigation.ts";

type LifecycleHost = {
  basePath: string;
  client?: { stop: () => void } | null;
  connected?: boolean;
  tab: Tab;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  chatHasAutoScrolled: boolean;
  chatManualRefreshInFlight: boolean;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatToolMessages: unknown[];
  chatStream: string;
  logsAutoFollow: boolean;
  logsAtBottom: boolean;
  logsEntries: unknown[];
  popStateHandler: () => void;
  /** Auth Phase 1 — bumped on every `hashchange` so Lit re-renders and
   *  the unauth hash route (e.g. #/auth/forgot-password) is picked up. */
  hashRouteTick?: number;
  topbarObserver: ResizeObserver | null;
};

// Scoped to this module so we don't leak a second listener per app mount.
const HASH_HANDLERS = new WeakMap<LifecycleHost, () => void>();

export function handleConnected(host: LifecycleHost) {
  host.basePath = inferBasePath();
  void loadControlUiBootstrapConfig(host);
  applySettingsFromUrl(host as unknown as Parameters<typeof applySettingsFromUrl>[0]);
  syncTabWithLocation(host as unknown as Parameters<typeof syncTabWithLocation>[0], true);
  syncThemeWithSettings(host as unknown as Parameters<typeof syncThemeWithSettings>[0]);
  attachThemeListener(host as unknown as Parameters<typeof attachThemeListener>[0]);
  window.addEventListener("popstate", host.popStateHandler);
  // Auth Phase 1: the forgot-password / reset-password / temp-password views
  // are routed via window.location.hash.  Changing the hash fires `hashchange`
  // but NOT `popstate`, and onPopState bails early when the URL isn't a
  // recognized tab, so we need a dedicated handler that just bumps a counter
  // to trigger a Lit re-render.
  const hashHandler = () => {
    host.hashRouteTick = (host.hashRouteTick ?? 0) + 1;
  };
  HASH_HANDLERS.set(host, hashHandler);
  window.addEventListener("hashchange", hashHandler);
  // Defer gateway connection and polling until the user is authenticated.
  // The auth-success handler in renderApp calls state.connect() after login/register.
  if (isAuthenticated()) {
    connectGateway(host as unknown as Parameters<typeof connectGateway>[0]);
    startNodesPolling(host as unknown as Parameters<typeof startNodesPolling>[0]);
    if (host.tab === "logs") {
      startLogsPolling(host as unknown as Parameters<typeof startLogsPolling>[0]);
    }
    if (host.tab === "debug") {
      startDebugPolling(host as unknown as Parameters<typeof startDebugPolling>[0]);
    }
    if (host.tab === "chat") {
      startSandboxPolling(host as unknown as Parameters<typeof startSandboxPolling>[0]);
    }
  }
}

export function handleFirstUpdated(host: LifecycleHost) {
  observeTopbar(host as unknown as Parameters<typeof observeTopbar>[0]);
}

export function handleDisconnected(host: LifecycleHost) {
  window.removeEventListener("popstate", host.popStateHandler);
  const hashHandler = HASH_HANDLERS.get(host);
  if (hashHandler) {
    window.removeEventListener("hashchange", hashHandler);
    HASH_HANDLERS.delete(host);
  }
  stopNodesPolling(host as unknown as Parameters<typeof stopNodesPolling>[0]);
  stopLogsPolling(host as unknown as Parameters<typeof stopLogsPolling>[0]);
  stopDebugPolling(host as unknown as Parameters<typeof stopDebugPolling>[0]);
  stopSandboxPolling(host as unknown as Parameters<typeof stopSandboxPolling>[0]);
  host.client?.stop();
  host.client = null;
  host.connected = false;
  detachThemeListener(host as unknown as Parameters<typeof detachThemeListener>[0]);
  host.topbarObserver?.disconnect();
  host.topbarObserver = null;
}

export function handleUpdated(host: LifecycleHost, changed: Map<PropertyKey, unknown>) {
  if (host.tab === "chat" && host.chatManualRefreshInFlight) {
    return;
  }
  if (
    host.tab === "chat" &&
    (changed.has("chatMessages") ||
      changed.has("chatToolMessages") ||
      changed.has("chatStream") ||
      changed.has("chatLoading") ||
      changed.has("tab"))
  ) {
    const forcedByTab = changed.has("tab");
    const forcedByLoad =
      changed.has("chatLoading") && changed.get("chatLoading") === true && !host.chatLoading;
    scheduleChatScroll(
      host as unknown as Parameters<typeof scheduleChatScroll>[0],
      forcedByTab || forcedByLoad || !host.chatHasAutoScrolled,
    );
  }
  if (
    host.tab === "logs" &&
    (changed.has("logsEntries") || changed.has("logsAutoFollow") || changed.has("tab"))
  ) {
    if (host.logsAutoFollow && host.logsAtBottom) {
      scheduleLogsScroll(
        host as unknown as Parameters<typeof scheduleLogsScroll>[0],
        changed.has("tab") || changed.has("logsAutoFollow"),
      );
    }
  }
}
