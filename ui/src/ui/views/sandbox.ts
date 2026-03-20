import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { extractToolCards, renderToolCardSidebar } from "../chat/tool-cards.ts";
import type { GatewaySessionRow, SessionsListResult } from "../types.ts";

export type TaskTodo = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done";
};

export type TaskPlanSnapshot = {
  description: string;
  todos: TaskTodo[];
  phase?: "planning" | "execution" | "verification" | "complete";
};

export type SandboxProps = {
  sessionKey: string;
  loading: boolean;
  result: SessionsListResult | null;
  error: string | null;
  onRefresh: () => void;
  onForceRestart?: () => void;
  /** Live task plan from the main agent's planner file. Optional. */
  taskPlan?: TaskPlanSnapshot | null;
  /** Live chat messages sent by agents */
  sandboxChatEvents?: Record<string, unknown>;
};

// ─── Task status helpers ──────────────────────────────────────────────────────
function tokenProgress(row: GatewaySessionRow): number {
  if (!row.outputTokens || !row.inputTokens) {
    return 0;
  }
  const ratio = row.outputTokens / (row.inputTokens + row.outputTokens);
  return Math.min(100, Math.round(ratio * 100));
}

function relativeTime(ts: number | null | undefined): string {
  if (!ts) {
    return "—";
  }
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) {
    return String(t("sandbox.relativeTime.secondsAgo", { seconds: String(secs) }));
  }
  if (secs < 3600) {
    return String(t("sandbox.relativeTime.minutesAgo", { minutes: String(Math.floor(secs / 60)) }));
  }
  return String(t("sandbox.relativeTime.hoursAgo", { hours: String(Math.floor(secs / 3600)) }));
}

function sessionStatusLabel(row: GatewaySessionRow): string {
  if (row.outputTokens && row.outputTokens > 0) {
    return String(t("sandbox.status.snapping"));
  }
  if (row.abortedLastRun) {
    return String(t("sandbox.status.stuck"));
  }
  return String(t("sandbox.status.beach"));
}

function sessionStatusColor(row: GatewaySessionRow): string {
  if (row.abortedLastRun) {
    return "var(--color-danger, #ef4444)";
  }
  if (row.outputTokens && row.outputTokens > 0) {
    return "#f59e0b";
  }
  return "#64748b";
}

// ─── 3D CSS Manager Figure ───────────────────────────────────────────────────
function renderManagerFigure(busy: boolean) {
  const activity = busy ? "typing" : "coffee";
  return html`
    <div class="figure figure--manager ${busy ? "figure--busy" : ""} figure--${activity}">
      ${
        activity === "coffee"
          ? html`
              <div class="figure__cup"></div>
            `
          : nothing
      }
      <div class="figure__crown">
        <div class="crown__point crown__point--l"></div>
        <div class="crown__point crown__point--c"></div>
        <div class="crown__point crown__point--r"></div>
        <div class="crown__band"></div>
      </div>
      <div class="figure__head">
        <div class="figure__face">
          <div class="figure__eye figure__eye--l"></div>
          <div class="figure__eye figure__eye--r"></div>
        </div>
        <div class="figure__head-side figure__head-side--l"></div>
        <div class="figure__head-side figure__head-side--r"></div>
        <div class="figure__head-top"></div>
      </div>
      <div class="figure__body">
        <div class="figure__body-side figure__body-side--l"></div>
        <div class="figure__body-side figure__body-side--r"></div>
        <div class="figure__body-top"></div>
        <div class="figure__badge"></div>
      </div>
      <div class="figure__arm figure__arm--l"></div>
      <div class="figure__arm figure__arm--r"></div>
      <div class="figure__legs">
        <div class="figure__leg figure__leg--l"></div>
        <div class="figure__leg figure__leg--r"></div>
      </div>
      <div class="figure__shadow"></div>
    </div>
  `;
}

// ─── 3D CSS Worker Lobster Figure ────────────────────────────────────────────
function renderWorkerFigure(row: GatewaySessionRow) {
  const isWorking = Boolean(row.outputTokens && row.outputTokens > 0);
  const modelStr = (row.model || "").toLowerCase();
  const labelStr = (row.label || "").toLowerCase();
  let activity = "coffee";
  if (isWorking) {
    if (
      modelStr.includes("vision") ||
      modelStr.includes("claude") ||
      labelStr.includes("search") ||
      labelStr.includes("analyze")
    ) {
      activity = "mining";
    } else {
      activity = "typing";
    }
  }

  return html`
    <div class="figure figure--worker ${isWorking ? "figure--busy" : "figure--idle"} figure--${activity}">
      ${
        activity === "mining"
          ? html`
              <div class="figure__pickaxe"></div>
            `
          : nothing
      }
      ${
        activity === "coffee"
          ? html`
              <div class="figure__cup"></div>
            `
          : nothing
      }
      <div class="figure__antenna figure__antenna--l"></div>
      <div class="figure__antenna figure__antenna--r"></div>
      <div class="figure__head">
        <div class="figure__face">
          <div class="figure__eye figure__eye--l"></div>
          <div class="figure__eye figure__eye--r"></div>
        </div>
        <div class="figure__head-side figure__head-side--l"></div>
        <div class="figure__head-side figure__head-side--r"></div>
        <div class="figure__head-top"></div>
      </div>
      <div class="figure__body">
        <div class="figure__body-side figure__body-side--l"></div>
        <div class="figure__body-side figure__body-side--r"></div>
        <div class="figure__body-top"></div>
      </div>
      <div class="figure__claw figure__claw--l">
        <div class="claw__upper"></div>
        <div class="claw__lower"></div>
      </div>
      <div class="figure__claw figure__claw--r">
        <div class="claw__upper"></div>
        <div class="claw__lower"></div>
      </div>
      <div class="figure__legs">
        <div class="figure__leg figure__leg--l"></div>
        <div class="figure__leg figure__leg--r"></div>
      </div>
      <div class="figure__shadow"></div>
    </div>
  `;
}

// ─── Timeline panel per subagent tasks ───────────────────────────────────────
function renderTimeline(rows: GatewaySessionRow[]) {
  const events = rows
    .filter((r) => r.kind !== "global")
    .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  if (events.length === 0) {
    return html`
      <div class="sidebar-empty" style="padding-top: 0">${t("sandbox.timeline.waiting")}</div>
    `;
  }

  // Group events by Today vs Yesterday/Older
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const todayEvents = events.filter((e) => (e.updatedAt ?? 0) >= startOfToday);
  const olderEvents = events.filter((e) => (e.updatedAt ?? 0) < startOfToday);

  // Helper to render a group of events
  const renderGroup = (title: string, groupEvents: GatewaySessionRow[]) => {
    if (groupEvents.length === 0) {return nothing;}
    return html`
      <div class="timeline-group">
        <div class="timeline-group__title">${title}</div>
        ${groupEvents.map(
          (r) => html`
            <div class="timeline__item">
              <div class="timeline__dot" style="background: ${sessionStatusColor(r)}; box-shadow: 0 0 6px ${sessionStatusColor(r)};"></div>
              <div class="timeline__content">
                <div style="display: flex; gap: 8px; align-items: baseline;">
                  <span class="timeline__label">${r.label || r.key.slice(0, 14)}</span>
                  <span class="timeline__time">${relativeTime(r.updatedAt)}</span>
                </div>
                <span class="timeline__status" style="color: ${sessionStatusColor(r)}">${sessionStatusLabel(r)}</span>
                ${r.subject ? html`<div class="timeline__subject" style="font-size: 0.75rem; color: rgba(255,255,255,0.6); margin-top: 4px;">${r.subject}</div>` : nothing}
              </div>
            </div>
          `,
        )}
      </div>
    `;
  };

  return html`
    <div class="timeline">
      ${renderGroup(String(t("sandbox.timeline.today")), todayEvents)}
      ${renderGroup(String(t("sandbox.timeline.older")), olderEvents)}
    </div>
  `;
}

// ─── Task Plan Panel (main agent's write_todos state) ────────────────────────
// Phase 5: workerRows enables keyword matching between todo titles and worker labels
// Phase 6: confetti CSS animation when allDone
function renderTaskPlanPanel(
  plan: TaskPlanSnapshot | null | undefined,
  workerRows?: GatewaySessionRow[],
) {
  if (!plan || plan.todos.length === 0) {
    return html`
      <div class="sidebar-empty" style="padding: 12px">
        <span>${t("sandbox.plan.resting")}</span>
      </div>
    `;
  }
  const done = plan.todos.filter((t) => t.status === "done").length;
  const total = plan.todos.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = done === total;

  // Phase 5: Build keyword map from worker labels for association
  const workers = workerRows ?? [];
  function findLinkedWorker(todoTitle: string): GatewaySessionRow | undefined {
    const titleLower = todoTitle.toLowerCase();
    const titleWords = titleLower.split(/\s+/).filter((w) => w.length > 2);
    return workers.find((w) => {
      const label = (w.label || w.subject || "").toLowerCase();
      return titleWords.some(
        (word) => label.includes(word) || (w.subject ?? "").toLowerCase().includes(word),
      );
    });
  }

  return html`
    <div class="task-plan ${allDone ? 'task-plan--complete' : ''}">
      ${plan.description ? html`<div class="task-plan__desc">${plan.description}</div>` : nothing}
      <div class="task-plan__progress-row">
        <span>${t("sandbox.plan.tasksProgress", { done: String(done), total: String(total) })}</span>
        <span>${pct}%</span>
      </div>
      <div class="task-plan__bar">
        <div
          class="task-plan__fill"
          style="width: ${pct}%; background: ${allDone ? '#10b981' : '#818cf8'};"
        ></div>
      </div>
      <div class="task-plan__list">
        ${plan.todos.map((t) => {
          const icon = t.status === "done" ? "✅" : t.status === "in_progress" ? "🔄" : "⏳";
          const cls =
            t.status === "done"
              ? "task-plan__item task-plan__item--done"
              : t.status === "in_progress"
                ? "task-plan__item task-plan__item--active"
                : "task-plan__item";
          const linked = findLinkedWorker(t.title);
          return html`<div class="${cls}">
            ${icon} ${t.title}
            ${linked
              ? html`<span class="task-plan__worker-link" title="Linked: ${linked.label || linked.key}">🔗</span>`
              : nothing}
          </div>`;
        })}
      </div>
      ${
        allDone
          ? html`
              <div class="task-plan__complete">
                <span class="task-plan__celebrate">🎉</span>
                <span>${t("sandbox.plan.allDone")}</span>
                <span class="task-plan__celebrate">🎉</span>
              </div>
              <div class="task-plan__confetti">
                ${Array.from({ length: 20 }, (_, i) =>
                  html`<span class="confetti-piece" style="--i:${i}; --x:${Math.random() * 100}; --delay:${Math.random() * 2}s; --color:${['#818cf8','#10b981','#f59e0b','#ef4444','#ec4899','#06b6d4'][i % 6]}"></span>`,
                )}
              </div>
            `
          : nothing
      }
    </div>
  `;
}

// ─── Task info floating card per subagent ────────────────────────────────────
function renderTaskCard(row: GatewaySessionRow, index: number) {
  const progress = tokenProgress(row);
  const status = sessionStatusLabel(row);
  const statusColor = sessionStatusColor(row);
  const isWorking = status === "🔥 Snapping claws!";
  const totalTokens = (row.totalTokens ?? 0).toLocaleString();

  return html`
    <div class="task-card ${isWorking ? "task-card--active" : "task-card--idle"}">
      <div class="task-card__header">
        <span class="task-card__index">🦞 #${index + 1}</span>
        <span class="task-card__title">${row.label || row.key.slice(0, 14)}</span>
        <span class="task-card__status" style="background: ${statusColor};">${status}</span>
      </div>
      <div class="task-card__body">
        ${row.subject ? html`<div class="task-card__task">${row.subject}</div>` : nothing}
        <div class="task-card__progress-row">
          <span>${t("sandbox.card.progress")}</span>
          <span>${progress}%</span>
        </div>
        <div class="task-card__progress-bar">
          <div class="task-card__progress-fill" style="width: ${progress}%; background: ${statusColor};"></div>
        </div>
        <div class="task-card__meta">
          ${row.model ? html`<span class="meta-chip">🤖 ${row.model}</span>` : nothing}
          ${row.outputTokens ? html`<span class="meta-chip">⚡ ${totalTokens} tok</span>` : nothing}
          <span class="meta-chip">🕐 ${relativeTime(row.updatedAt)}</span>
        </div>
      </div>
      ${
        isWorking
          ? html`
              <div class="task-card__working-bar"></div>
            `
          : nothing
      }
    </div>
  `;
}

// Keep a lightweight state in module scope to track previous positions for directional facing
const prevPositions: Record<string, { cx: number; cy: number; facingLeft: boolean }> = {};

// ─── Main render ─────────────────────────────────────────────────────────────
export function renderSandbox(props: SandboxProps) {
  const rows = props.result?.sessions ?? [];
  const globalSession = rows.find((r) => r.kind === "global");
  
  // Only show active sessions that belong to the current session tree
  const activeSessions = rows.filter(
    (row) => row.kind !== "global" && !row.systemSent && row.key.startsWith(props.sessionKey),
  );
  
  const totalBusy = activeSessions.filter((r) => r.outputTokens && r.outputTokens > 0).length;
  const totalIdle = activeSessions.length - totalBusy;
  const totalTokens = activeSessions.reduce((sum, r) => sum + (r.totalTokens ?? 0), 0);
  
  // Health computation
  const healthAborted = activeSessions.filter((r) => r.abortedLastRun).length;
  const healthPercent = activeSessions.length === 0 ? 100 : Math.max(0, Math.round(((activeSessions.length - healthAborted) / activeSessions.length) * 100));
  const healthStatus = healthPercent === 100 ? String(t("sandbox.health.excellent")) : healthPercent > 50 ? String(t("sandbox.health.degraded")) : String(t("sandbox.health.critical"));
  const healthColor = healthPercent === 100 ? "#10b981" : healthPercent > 50 ? "#f59e0b" : "#ef4444";

  // Calculate Time of Day
  const hour = new Date().getHours();
  // Day: 7am to 6pm (18). Night: 6pm to 7am.
  const isNight = hour >= 18 || hour < 7;

  const bgGradient = isNight
    ? "linear-gradient(160deg, #020617 0%, #0f172a 50%, #09090b 100%)" // Dark space
    : "linear-gradient(160deg, #080d1a 0%, #0d1332 50%, #120826 100%)"; // Brighter indigo

  const glowPrimary = isNight ? "rgba(56, 189, 248, 0.15)" : "rgba(99, 102, 241, 0.1)";
  const glowSecondary = isNight ? "rgba(167, 139, 250, 0.12)" : "rgba(168, 85, 247, 0.08)";
  const particleOpacity = isNight ? "0.8" : "0.5";

  return html`
    <style>
      /* ═══════════════════════════════════════════════
         SANDBOX CANVAS — full screen fill
      ═══════════════════════════════════════════════ */
      .sandbox-wrap {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: calc(100vh - 120px);
        
        /* Forced Dark Theme for Sandbox */
        --card: #1e293b;
        --text: #f8fafc;
        --border: rgba(255, 255, 255, 0.1);
        
        /* Dynamic Time Variables injected via inline style */
        background: var(--bg-gradient, linear-gradient(160deg, #080d1a 0%, #0d1332 50%, #120826 100%));
        
        border-radius: 16px;
        border: 1px solid rgba(99, 102, 241, 0.18);
        overflow: hidden;
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
        transition: background 2s ease;
      }

      /* ─── Top Command Bar ─── */
      .sandbox-header {
        display: flex;
        align-items: center;
        gap: 24px;
        padding: 16px 24px;
        background: rgba(255, 255, 255, 0.03);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        flex-shrink: 0;
        z-index: 10;
      }

      .sandbox-header__title {
        font-size: 0.95rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        background: linear-gradient(90deg, #f87171, #f97316);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .sandbox-header__sub {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.3);
      }

      .sandbox-wrap .sandbox-header__stats {
        display: flex;
        gap: 16px;
        margin-left: auto;
        align-items: center;
      }

      .sandbox-wrap .stat-chip {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.55);
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.07);
        padding: 5px 12px;
        border-radius: 20px;
      }

      .sandbox-wrap .stat-chip__dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
      }

      .sandbox-wrap .stat-chip__dot--busy {
        background: #f59e0b;
        box-shadow: 0 0 6px #f59e0b;
        animation: pulse-dot 1.5s ease-in-out infinite;
      }

      .sandbox-wrap .stat-chip__dot--idle {
        background: #475569;
      }

      .sandbox-wrap .stat-chip__dot--total {
        background: #f97316;
        box-shadow: 0 0 6px #f97316;
      }

      @keyframes pulse-dot {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.4;
        }
      }

      /* ─── Main content split ─── */
      /* Bubble layout for compact tool cards */
      .sandbox-wrap .chat-bubble--cards {
        overflow-y: auto !important;
        pointer-events: auto !important;
        max-height: 220px !important;
        width: 320px !important;
        padding: 8px !important;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      
      .sandbox-wrap .chat-bubble--cards::-webkit-scrollbar {
        width: 4px;
      }
      .sandbox-wrap .chat-bubble--cards::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 2px;
      }
      
      /* Constrain large content in embedded chat cards */
      .sandbox-wrap .chat-bubble--cards .chat-tool-card {
        margin: 0 !important;
        border: 1px solid rgba(255,255,255,0.1) !important;
        background: rgba(0,0,0,0.2) !important;
      }
      .sandbox-wrap .chat-bubble--cards pre {
        max-height: 100px !important;
        font-size: 0.65rem !important;
        margin: 4px 0 0 0 !important;
      }
      .sandbox-wrap .chat-bubble--cards .tool-call__header {
        padding: 6px !important;
        font-size: 0.75rem !important;
      }
      
      .sandbox-wrap .sandbox-body {
        display: flex;
        flex: 1;
        min-height: 0;
        gap: 0;
      }

      /* ─── Center 3D Stage ─── */
      .sandbox-wrap .sandbox-stage {
        flex: 1;
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .sandbox-wrap .sandbox-stage::before {
        content: "";
        position: absolute;
        inset: 0;
        background: radial-gradient(
            ellipse at 40% 50%,
            var(--glow-primary, rgba(99, 102, 241, 0.1)) 0%,
            transparent 55%
          ),
          radial-gradient(
            ellipse at 70% 60%,
            var(--glow-secondary, rgba(168, 85, 247, 0.08)) 0%,
            transparent 50%
          );
        pointer-events: none;
        transition: background 2s ease;
      }

      /* Matrix Particle effect for floor */
      .sandbox-wrap .stage-particles {
        position: absolute;
        inset: 0;
        background-image: radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px);
        background-size: 40px 40px;
        animation: particle-rise 30s linear infinite;
        pointer-events: none;
        opacity: var(--particle-opacity, 0.5);
      }
      
      @keyframes particle-rise {
        from { background-position: 0 0; }
        to { background-position: 0 -400px; }
      }

      /* Grid Floor */
      .sandbox-wrap .sandbox-grid {
        position: absolute;
        width: 150%;
        height: 150%;
        background-size: 70px 70px;
        background-image: linear-gradient(
            to right,
            rgba(139, 92, 246, 0.1) 1px,
            transparent 1px
          ),
          linear-gradient(to bottom, rgba(139, 92, 246, 0.1) 1px, transparent 1px);
        transform: rotateX(58deg) rotateZ(-42deg);
        mask-image: radial-gradient(ellipse at center, black 20%, transparent 65%);
        -webkit-mask-image: radial-gradient(
          ellipse at center,
          black 20%,
          transparent 65%
        );
      }

      /* ─── Office Zones (Floor painting) ─── */
      .sandbox-wrap .zone {
        position: absolute;
        border: 2px dashed rgba(255, 255, 255, 0.15);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.02);
        transform: rotateX(58deg) rotateZ(-42deg);
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .zone::after {
        content: attr(data-label);
        position: absolute;
        bottom: -24px;
        font-size: 0.85rem;
        font-weight: 800;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.2);
        transform: rotateZ(42deg) rotateX(-58deg);
      }
      .zone--hq {
        width: 250px;
        height: 180px;
        /* Center Top */
        top: 25%;
        left: 50%;
        margin-left: -125px;
        margin-top: -90px;
        border-color: rgba(129, 140, 248, 0.3);
        background: rgba(129, 140, 248, 0.05);
      }
      .zone--hq::after { color: rgba(129, 140, 248, 0.5); bottom: auto; top: -30px; content: '${t("sandbox.zones.hq")}'; }
      
      .zone--dev {
        width: 300px;
        height: 240px;
        /* Bottom Left */
        top: 65%;
        left: 30%;
        margin-left: -150px;
        margin-top: -120px;
        border-color: rgba(245, 158, 11, 0.2);
        background: rgba(245, 158, 11, 0.03);
      }
      .zone--dev::after { color: rgba(245, 158, 11, 0.4); content: '${t("sandbox.zones.dev")}'; }

      .zone--cafe {
        width: 220px;
        height: 180px;
        /* Bottom Right */
        top: 60%;
        left: 75%;
        margin-left: -110px;
        margin-top: -90px;
        border-color: rgba(16, 185, 129, 0.2);
        background: rgba(16, 185, 129, 0.03);
      }
      .zone--cafe::after { color: rgba(16, 185, 129, 0.4); content: '${t("sandbox.zones.cafe")}'; }

      /* ─── Immersive Props ─── */
      .sandbox-wrap .prop {
        position: absolute;
        transform-style: preserve-3d;
        pointer-events: none;
      }
      
      /* Server Rack Prop for HQ */
      .sandbox-wrap .prop-server {
        width: 40px;
        height: 60px;
        background: linear-gradient(135deg, #1e293b, #0f172a);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 4px;
        bottom: 20px;
        left: 20px;
        box-shadow: 10px 10px 20px rgba(0,0,0,0.5);
      }
      .sandbox-wrap .prop-server::before {
        content: "";
        position: absolute;
        top: 10px; left: 5px; right: 5px; height: 4px;
        background: #3b82f6; box-shadow: 0 0 8px #3b82f6, 0 10px 0 #10b981;
        border-radius: 2px;
      }
      
      /* Anvil for Dev Lab */
      .sandbox-wrap .prop-anvil {
        width: 50px;
        height: 25px;
        background: linear-gradient(90deg, #475569, #334155);
        border-radius: 4px 4px 0 0;
        bottom: 30%;
        left: 45%;
        box-shadow: 0 15px 15px rgba(0,0,0,0.4);
        position: absolute;
      }
      .sandbox-wrap .prop-anvil-active::after {
        content: "";
        position: absolute;
        top: -10px; left: 50%; transform: translateX(-50%);
        width: 100px; height: 100px;
        background: radial-gradient(circle, rgba(245, 158, 11, 0.2) 0%, transparent 70%);
        border-radius: 50%;
        animation: sandbox-pulse-aura 2s ease-in-out infinite;
      }
      
      /* Dev Lab Active Code Particles */
      .sandbox-wrap .prop-anvil-active::before {
        content: "{ } </>";
        position: absolute;
        top: -40px;
        left: 50%;
        transform: translateX(-50%);
        font-family: monospace;
        font-size: 14px;
        font-weight: bold;
        color: rgba(59, 130, 246, 0.8);
        text-shadow: 0 0 8px rgba(59, 130, 246, 1);
        white-space: nowrap;
        animation: sandbox-float-code 2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        opacity: 0;
      }

      @keyframes float-code {
        0% { transform: translate(-50%, 0) scale(0.8); opacity: 0; }
        20% { opacity: 1; }
        80% { transform: translate(-50%, -30px) scale(1.1); opacity: 0.8; }
        100% { transform: translate(-50%, -40px) scale(1); opacity: 0; }
      }
      
      @keyframes pulse-aura {
        0%, 100% { transform: translateX(-50%) scale(0.8); opacity: 0.5; }
        50% { transform: translateX(-50%) scale(1.2); opacity: 1; }
      }
      
      .sandbox-wrap .prop-anvil .anvil-body {
        content: "";
        position: absolute;
        top: 25px; left: 10px; width: 30px; height: 15px;
        background: #1e293b;
      }
      
      /* Coffee Table for Cafe */
      .sandbox-wrap .prop-table {
        width: 60px;
        height: 60px;
        background: rgba(255,255,255,0.05);
        border: 2px solid rgba(255,255,255,0.1);
        border-radius: 50%;
        bottom: 40%;
        left: 50%;
        transform: translateX(-50%) rotateX(58deg);
        box-shadow: 0 20px 20px rgba(0,0,0,0.3);
      }

      .sandbox-wrap .chat-bubble {
        position: absolute;
        bottom: 100%;
        margin-bottom: 25px;
        background: #1e293b; /* Refined dark background for sandbox */
        border: 1px solid rgba(255, 255, 255, 0.15);
        padding: 6px 14px;
        border-radius: 12px;
        font-size: 0.75rem;
        color: #f8fafc; /* Forced light text for sandbox */
        white-space: nowrap;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6);
        animation: float-bubble 3s ease-in-out infinite, pop-bubble 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        z-index: 50;
        pointer-events: auto;
      }
      
      .sandbox-wrap .chat-bubble::after {
        content: "";
        position: absolute;
        bottom: -6px;
        left: 50%;
        transform: translateX(-50%);
        border-width: 6px 6px 0;
        border-style: solid;
        border-color: #1e293b transparent transparent transparent;
      }
      
      .sandbox-wrap .chat-bubble--cards {
        width: 280px;
        max-height: 220px;
        overflow-y: auto;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        white-space: normal;
      }
      
      .sandbox-wrap .chat-bubble--cards::-webkit-scrollbar {
        width: 4px;
      }
      .sandbox-wrap .chat-bubble--cards::-webkit-scrollbar-track {
        background: transparent;
      }
      .sandbox-wrap .chat-bubble--cards::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
      }
      
      .sandbox-wrap .chat-bubble--cards .chat-tool-card {
        margin-top: 0;
        background: rgba(255,255,255,0.03);
      }

      @keyframes pop-bubble {
        0% { transform: scale(0.5); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }
      
      @keyframes float-bubble {
        0%, 100% { margin-bottom: 25px; }
        50% { margin-bottom: 30px; }
      }

      /* ─── Agent Slots ─── */
      .sandbox-wrap .agent-slot {
        position: absolute;
        pointer-events: none;
        transition: top 1s cubic-bezier(0.4, 0, 0.2, 1), left 1s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 0; /* Changed to 0 so it doesn't block background */
        height: 0;
        will-change: top, left;
        z-index: 2;
      }

      .sandbox-wrap .agent-slot > * {
        pointer-events: auto; /* Re-enable for children */
      }

      .sandbox-wrap .agent-slot:hover {
        z-index: 10;
        transform: translateY(-12px) scale(1.05);
      }

      .sandbox-wrap .agent-slot:hover .figure {
        filter: drop-shadow(0 0 20px rgba(139, 92, 246, 0.8));
      }

      .sandbox-wrap .agent-name-tag {
        font-size: 0.65rem;
        background: rgba(15, 23, 42, 0.8);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.9);
        padding: 4px 8px;
        border-radius: 4px;
        margin-top: -6px;
        text-align: center;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        white-space: nowrap;
      }

      .sandbox-wrap .agent-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-top: 4px;
      }

      .sandbox-wrap .agent-status-dot--working {
        background: #f59e0b;
        box-shadow: 0 0 8px #f59e0b;
        animation: sandbox-sd 1.5s ease-in-out infinite;
      }

      .sandbox-wrap .agent-status-dot--idle {
        background: #475569;
      }

      .sandbox-wrap .agent-status-dot--aborted {
        background: #ef4444;
        box-shadow: 0 0 8px #ef4444;
      }

      @keyframes sandbox-sd {
        0%,
        100% {
          box-shadow: 0 0 6px #f59e0b;
        }
        50% {
          box-shadow: 0 0 16px #f59e0b, 0 0 30px rgba(245, 158, 11, 0.4);
        }
      }

      /* ─── FIGURES ─── */
      .sandbox-wrap .figure {
        position: relative;
        transform-style: preserve-3d;
        animation: sandbox-bob 3.5s ease-in-out infinite;
      }

      @keyframes sandbox-bob {
        0%,
        100% {
          margin-top: 0;
        }
        50% {
          margin-top: -14px;
        }
      }

      /* Activity Animations */
      @keyframes sandbox-type {
        0%, 100% { transform: rotate(0deg); }
        50% { transform: rotate(15deg) translateY(2px); }
      }
      .sandbox-wrap .figure--typing .figure__arm, .sandbox-wrap .figure--typing .figure__claw {
        animation: sandbox-type 0.3s ease-in-out infinite;
      }

      @keyframes sandbox-pickaxe-swing {
        0%, 100% { transform: rotate(-30deg) translateY(0); }
        50% { transform: rotate(60deg) translateY(10px); }
      }
      .sandbox-wrap .figure__pickaxe {
        position: absolute;
        top: 30px;
        right: -10px;
        width: 8px;
        height: 60px;
        background: linear-gradient(180deg, #9ca3af 0%, #4b5563 100%);
        border-radius: 4px;
        transform-origin: top center;
        z-index: 10;
        pointer-events: none;
      }
      .sandbox-wrap .figure__pickaxe::before {
        content: "";
        position: absolute;
        top: -6px;
        left: -15px;
        width: 38px;
        height: 16px;
        background: linear-gradient(90deg, #cbd5e1 0%, #64748b 100%);
        border-radius: 4px;
      }
      .sandbox-wrap .figure--mining .figure__pickaxe {
        animation: sandbox-pickaxe-swing 0.8s ease-in-out infinite;
      }

      @keyframes sandbox-steam {
        0% { opacity: 0; transform: translateY(0) scale(0.8); }
        50% { opacity: 0.8; }
        100% { opacity: 0; transform: translateY(-25px) scale(1.2); }
      }
      .sandbox-wrap .figure__cup {
        position: absolute;
        bottom: 20px;
        right: -12px;
        width: 18px;
        height: 20px;
        background: #fcd34d;
        border-radius: 3px 3px 8px 8px;
        z-index: 10;
        box-shadow: inset -3px -3px 6px rgba(217, 119, 6, 0.4);
        pointer-events: none;
      }
      .sandbox-wrap .figure__cup::before {
        content: "";
        position: absolute;
        top: 2px;
        right: -6px;
        width: 8px;
        height: 12px;
        border: 3px solid #fcd34d;
        border-radius: 0 6px 6px 0;
      }
      .sandbox-wrap .figure--coffee .figure__cup::after {
        content: "";
        position: absolute;
        top: -8px;
        left: 3px;
        width: 12px;
        height: 12px;
        background: radial-gradient(circle, rgba(255,255,255,0.7) 0%, transparent 70%);
        border-radius: 50%;
        animation: sandbox-steam 2.5s infinite linear;
      }

      /* Crown */
      .sandbox-wrap .figure__crown {
        position: relative;
        width: 50px;
        height: 20px;
        margin: 0 auto 2px;
      }

      .sandbox-wrap .crown__point {
        position: absolute;
        bottom: 8px;
        width: 0;
        height: 0;
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
        border-bottom: 18px solid #fbbf24;
        filter: drop-shadow(0 0 5px #d97706);
      }

      .sandbox-wrap .crown__point--l {
        left: 4px;
        border-bottom-width: 14px;
      }

      .sandbox-wrap .crown__point--c {
        left: 50%;
        transform: translateX(-50%);
        border-bottom-color: #fcd34d;
        border-bottom-width: 20px;
        border-left-width: 6px;
        border-right-width: 6px;
      }

      .sandbox-wrap .crown__point--r {
        right: 4px;
        border-bottom-width: 14px;
      }

      .sandbox-wrap .crown__band {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 9px;
        background: linear-gradient(180deg, #fcd34d 0%, #d97706 100%);
        border-radius: 2px;
        box-shadow: 0 0 10px rgba(245, 158, 11, 0.7);
      }

      /* Head */
      .sandbox-wrap .figure__head {
        position: relative;
        width: 34px;
        height: 34px;
        margin: 0 auto 2px;
      }

      .sandbox-wrap .figure__face {
        position: absolute;
        inset: 0;
        background: linear-gradient(140deg, #c7d2fe 0%, #818cf8 100%);
        border-radius: 5px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        box-shadow: inset 0 -5px 8px rgba(0, 0, 0, 0.25);
      }

      .sandbox-wrap .figure--worker .figure__face {
        background: linear-gradient(140deg, #fca5a5 0%, #ef4444 100%);
      }

      .sandbox-wrap .figure__eye {
        width: 6px;
        height: 7px;
        border-radius: 50% 50% 40% 40%;
        background: #0f172a;
      }

      .sandbox-wrap .figure--busy .figure__eye {
        animation: sandbox-blink 3s ease-in-out infinite;
      }

      @keyframes sandbox-blink {
        0%,
        92%,
        100% {
          transform: scaleY(1);
        }
        96% {
          transform: scaleY(0.1);
        }
      }

      .sandbox-wrap .figure__head-side--l {
        position: absolute;
        top: 4px;
        left: -7px;
        width: 7px;
        height: 26px;
        background: linear-gradient(90deg, #3730a3, #4f46e5);
        border-radius: 3px 0 0 3px;
      }

      .sandbox-wrap .figure__head-side--r {
        position: absolute;
        top: 4px;
        right: -7px;
        width: 7px;
        height: 26px;
        background: linear-gradient(270deg, #3730a3, #4f46e5);
        border-radius: 0 3px 3px 0;
      }

      .sandbox-wrap .figure--worker .figure__head-side--l,
      .sandbox-wrap .figure--worker .figure__head-side--r {
        background: linear-gradient(90deg, #991b1b, #dc2626);
      }

      .sandbox-wrap .figure__head-top {
        position: absolute;
        top: -6px;
        left: 0;
        right: 0;
        height: 6px;
        background: #6366f1;
        border-radius: 3px 3px 0 0;
      }

      .sandbox-wrap .figure--worker .figure__head-top {
        background: #ef4444;
      }

      /* Body */
      .sandbox-wrap .figure__body {
        position: relative;
        width: 38px;
        height: 40px;
        margin: 0 auto;
      }

      .sandbox-wrap .figure--manager .figure__body::before {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(150deg, #3730a3, #1e1b4b);
        border-radius: 3px;
        box-shadow: inset 0 -5px 10px rgba(0, 0, 0, 0.3);
      }

      .sandbox-wrap .figure--worker .figure__body::before {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(150deg, #9f1239, #4c0519);
        border-radius: 3px;
        box-shadow: inset 0 -5px 10px rgba(0, 0, 0, 0.3);
      }

      .sandbox-wrap .figure__body-side--l {
        position: absolute;
        top: 4px;
        left: -8px;
        width: 8px;
        height: 32px;
        background: linear-gradient(90deg, #1e1b4b, #312e81);
        border-radius: 3px 0 0 3px;
      }

      .sandbox-wrap .figure__body-side--r {
        position: absolute;
        top: 4px;
        right: -8px;
        width: 8px;
        height: 32px;
        background: linear-gradient(270deg, #1e1b4b, #312e81);
        border-radius: 0 3px 3px 0;
      }

      .sandbox-wrap .figure--worker .figure__body-side--l,
      .sandbox-wrap .figure--worker .figure__body-side--r {
        background: linear-gradient(90deg, #4c0519, #7f1d1d);
      }

      .sandbox-wrap .figure__body-top {
        position: absolute;
        top: -6px;
        left: 0;
        right: 0;
        height: 6px;
        background: #6366f1;
        border-radius: 3px 3px 0 0;
      }

      .sandbox-wrap .figure--worker .figure__body-top {
        background: #dc2626;
      }

      .sandbox-wrap .figure__badge {
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        width: 14px;
        height: 14px;
        background: radial-gradient(circle, #fcd34d, #d97706);
        border-radius: 50%;
        box-shadow: 0 0 8px rgba(252, 211, 77, 0.9);
        z-index: 2;
      }

      /* Arms */
      .sandbox-wrap .figure__arm {
        position: absolute;
        width: 8px;
        height: 30px;
        border-radius: 4px;
        top: 60px;
        background: linear-gradient(180deg, #6366f1, #3730a3);
        transform-origin: top center;
        animation: sandbox-arm-l 2s ease-in-out infinite;
      }

      .sandbox-wrap .figure__arm--l {
        left: 10px;
        animation-name: sandbox-arm-l;
      }

      .sandbox-wrap .figure__arm--r {
        right: 10px;
        animation-name: sandbox-arm-r;
      }

      @keyframes sandbox-arm-l {
        0%,
        100% {
          transform: rotate(-12deg);
        }
        50% {
          transform: rotate(-28deg);
        }
      }

      @keyframes sandbox-arm-r {
        0%,
        100% {
          transform: rotate(12deg);
        }
        50% {
          transform: rotate(28deg);
        }
      }

      /* Lobster antenna */
      .sandbox-wrap .figure__antenna {
        position: absolute;
        width: 3px;
        height: 20px;
        background: linear-gradient(180deg, rgba(239, 68, 68, 0) 0%, #ef4444 100%);
        border-radius: 2px;
        top: -28px;
      }

      .sandbox-wrap .figure__antenna--l {
        left: 7px;
        transform-origin: bottom center;
        transform: rotate(-18deg);
        animation: sandbox-ant-l 2.5s ease-in-out infinite;
      }

      .sandbox-wrap .figure__antenna--r {
        right: 7px;
        transform-origin: bottom center;
        transform: rotate(18deg);
        animation: sandbox-ant-r 2.5s ease-in-out infinite 0.5s;
      }

      @keyframes sandbox-ant-l {
        0%,
        100% {
          transform: rotate(-18deg);
        }
        50% {
          transform: rotate(-30deg);
        }
      }

      @keyframes sandbox-ant-r {
        0%,
        100% {
          transform: rotate(18deg);
        }
        50% {
          transform: rotate(30deg);
        }
      }

      /* Lobster Claws */
      .sandbox-wrap .figure__claw {
        position: absolute;
        top: 56px;
        display: flex;
        flex-direction: column;
        gap: 3px;
        transform-origin: top center;
      }

      .sandbox-wrap .figure__claw--l {
        left: -2px;
        animation: sandbox-claw-l 1.8s ease-in-out infinite;
      }

      .sandbox-wrap .figure__claw--r {
        right: -2px;
        animation: sandbox-claw-r 1.8s ease-in-out infinite 0.9s;
      }

      .sandbox-wrap .claw__upper,
      .sandbox-wrap .claw__lower {
        width: 18px;
        height: 9px;
        background: linear-gradient(90deg, #dc2626, #9f1239);
        border-radius: 2px;
      }

      .sandbox-wrap .claw__upper {
        border-radius: 2px 10px 0 2px;
      }

      .sandbox-wrap .claw__lower {
        border-radius: 2px 0 10px 2px;
        transform-origin: left;
        transform: rotate(6deg);
      }

      @keyframes sandbox-claw-l {
        0%,
        100% {
          transform: rotate(-20deg);
        }
        50% {
          transform: rotate(-36deg);
        }
      }

      @keyframes sandbox-claw-r {
        0%,
        100% {
          transform: rotate(20deg);
        }
        50% {
          transform: rotate(36deg);
        }
      }

      /* Legs */
      .sandbox-wrap .figure__legs {
        display: flex;
        justify-content: center;
        gap: 5px;
        margin-top: 2px;
      }

      .sandbox-wrap .figure__leg {
        width: 9px;
        height: 22px;
        border-radius: 0 0 4px 4px;
      }

      .sandbox-wrap .figure--manager .figure__leg {
        background: linear-gradient(180deg, #312e81, #1e1b4b);
      }

      .sandbox-wrap .figure--worker .figure__leg {
        background: linear-gradient(180deg, #7f1d1d, #4c0519);
      }

      .sandbox-wrap .figure__leg--l {
        transform-origin: top center;
        animation: sandbox-leg-l 0.7s ease-in-out infinite;
      }

      .sandbox-wrap .figure__leg--r {
        transform-origin: top center;
        animation: sandbox-leg-r 0.7s ease-in-out infinite;
      }

      @keyframes sandbox-leg-l {
        0%,
        100% {
          transform: rotate(5deg);
        }
        50% {
          transform: rotate(-5deg);
        }
      }

      @keyframes sandbox-leg-r {
        0%,
        100% {
          transform: rotate(-5deg);
        }
        50% {
          transform: rotate(5deg);
        }
      }

      .sandbox-wrap .figure--idle .figure__leg--l,
      .sandbox-wrap .figure--idle .figure__leg--r,
      .sandbox-wrap .figure--idle .figure__claw--l,
      .sandbox-wrap .figure--idle .figure__claw--r,
      .sandbox-wrap .figure--idle .figure__arm--l,
      .sandbox-wrap .figure--idle .figure__arm--r {
        animation: none;
      }

      .sandbox-wrap .figure--idle {
        filter: brightness(0.6) saturate(0.4);
      }

      .sandbox-wrap .figure__shadow {
        width: 40px;
        height: 12px;
        background: radial-gradient(ellipse, rgba(0, 0, 0, 0.5) 0%, transparent 75%);
        border-radius: 50%;
        margin: 4px auto 0;
      }

      /* ─── Pipeline Factory Conveyor Belt ─── */
      .sandbox-wrap .pipeline {
        position: absolute;
        top: 60%;
        left: 50%;
        width: 140%;
        height: 100px;
        margin-left: -70%;
        transform: rotateX(58deg) rotateZ(48deg) translateY(-50px);
        transform-style: preserve-3d;
        z-index: 15;
      }
      
      .sandbox-wrap .pipeline__belt {
        position: absolute;
        inset: 0;
        background: repeating-linear-gradient(
          90deg,
          rgba(15, 23, 42, 0.8) 0px,
          rgba(15, 23, 42, 0.8) 15px,
          rgba(30, 41, 59, 0.9) 15px,
          rgba(30, 41, 59, 0.9) 30px
        );
        border: 2px solid rgba(139, 92, 246, 0.4);
        border-radius: 4px;
        box-shadow: 
          inset 0 10px 20px rgba(0,0,0,0.8),
          0 15px 30px rgba(0,0,0,0.5),
          0 0 15px rgba(99, 102, 241, 0.2);
        animation: pipeline-move 2s linear infinite;
        transform-style: preserve-3d;
      }
      
      .sandbox-wrap .pipeline__belt::before {
        content: "";
        position: absolute;
        bottom: -6px; left: 0; right: 0; height: 6px;
        background: linear-gradient(90deg, #312e81, #1e1b4b);
        transform: translateZ(-1px);
        border-radius: 0 0 4px 4px;
      }
      .sandbox-wrap .pipeline__belt::after {
        content: "";
        position: absolute;
        top: 0; bottom: 0; left: 0; right: 0;
        box-shadow: inset 0 0 20px rgba(99, 102, 241, 0.3);
        pointer-events: none;
      }

      @keyframes pipeline-move {
        from { background-position: 0 0; }
        to { background-position: 60px 0; } /* Matches repeating gradient size */
      }
      
      .sandbox-wrap .pipeline-task {
        position: absolute;
        bottom: 10px;
        width: 45px;
        height: 45px;
        background: #1e293b;
        border: 2px solid rgba(255,255,255,0.1);
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        box-shadow: -5px 15px 15px rgba(0,0,0,0.6);
        transition: left 1.5s cubic-bezier(0.4, 0, 0.2, 1), transform 0.5s;
        
        /* 3D Box look */
        transform: rotateX(-90deg) rotateY(0deg) translateZ(22px);
        transform-style: preserve-3d;
      }
      .sandbox-wrap .pipeline-task::before {
        content: "";
        position: absolute;
        top: -100%; left: -2px; width: 100%; height: 100%;
        background: #0f172a;
        transform-origin: bottom;
        transform: rotateX(90deg);
        border: 2px solid rgba(255,255,255,0.05);
        border-bottom: none;
      }
      .sandbox-wrap .pipeline-task::after {
        content: "";
        position: absolute;
        top: -2px; left: 100%; width: 100%; height: 100%;
        background: #334155;
        transform-origin: left;
        transform: rotateY(90deg);
        border: 2px solid rgba(255,255,255,0.1);
        border-left: none;
      }
      
      .sandbox-wrap .pipeline-task__label {
        position: absolute;
        top: -25px;
        left: 50%;
        transform: translateX(-50%) rotateX(0deg) translateZ(30px);
        font-size: 0.6rem;
        font-weight: 700;
        background: rgba(15, 23, 42, 0.9);
        color: white;
        padding: 2px 6px;
        border-radius: 4px;
        white-space: nowrap;
        pointer-events: none;
        box-shadow: 0 4px 6px rgba(0,0,0,0.4);
        border: 1px solid rgba(255,255,255,0.1);
      }

      .sandbox-wrap .pipeline-task--todo {
        border-color: rgba(148, 163, 184, 0.4);
        /* Grouped on left */
      }
      
      .sandbox-wrap .pipeline-task--active {
        border-color: #f59e0b;
        background: #78350f;
        box-shadow: 0 0 20px rgba(245, 158, 11, 0.6), -5px 15px 15px rgba(0,0,0,0.6);
        /* Center pulse */
        animation: pipeline-pulse 1s infinite alternate;
      }
      @keyframes pipeline-pulse {
        from { transform: rotateX(-90deg) rotateY(0deg) translateZ(22px) scale(1); }
        to { transform: rotateX(-90deg) rotateY(0deg) translateZ(22px) scale(1.1); box-shadow: 0 0 35px rgba(245, 158, 11, 0.9), -5px 15px 15px rgba(0,0,0,0.6); }
      }
      .sandbox-wrap .pipeline-task--active::before { background: #451a03; border-color: rgba(245, 158, 11, 0.3); }
      .sandbox-wrap .pipeline-task--active::after { background: #92400e; border-color: rgba(245, 158, 11, 0.5); }
      
      .sandbox-wrap .pipeline-task--done {
        border-color: #10b981;
        background: #064e3b;
        /* Grouped on right */
      }
      .sandbox-wrap .pipeline-task--done::before { background: #022c22; border-color: rgba(16, 185, 129, 0.2); }
      .sandbox-wrap .pipeline-task--done::after { background: #065f46; border-color: rgba(16, 185, 129, 0.4); }

      /* ─── Task Cards Sidebar ─── */
      .sandbox-wrap .sandbox-sidebar {
        width: 340px;
        flex-shrink: 0;
        background: rgba(255, 255, 255, 0.02);
        border-right: 1px solid rgba(255, 255, 255, 0.06);
        background: var(--color-bg-sidebar);
        border-right: 1px solid var(--color-border-light);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .sandbox-wrap .sandbox-sidebar-header {
        padding: 16px 20px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.3);
      }

      .sandbox-wrap .sidebar-cards {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .sandbox-wrap .sidebar-cards::-webkit-scrollbar {
        width: 4px;
      }

      .sandbox-wrap .sidebar-cards::-webkit-scrollbar-track {
        background: transparent;
      }

      .sandbox-wrap .sidebar-cards::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
      }

      /* Task Card */
      .sandbox-wrap .task-card {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 12px;
        overflow: hidden;
        transition: all 0.3s ease;
        position: relative;
      }

      .task-card--active {
        border-color: rgba(245, 158, 11, 0.35);
        background: rgba(245, 158, 11, 0.05);
      }

      .task-card:hover {
        border-color: rgba(139, 92, 246, 0.4);
        background: rgba(139, 92, 246, 0.06);
        transform: translateX(-4px);
      }

      .task-card__header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
      }

      .task-card__index {
        font-size: 0.65rem;
        font-weight: 800;
        color: rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.05);
        padding: 2px 6px;
        border-radius: 6px;
        flex-shrink: 0;
      }

      .task-card__title {
        font-size: 0.8rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.8);
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .task-card__status {
        font-size: 0.65rem;
        font-weight: 700;
        color: #fff;
        padding: 2px 8px;
        border-radius: 10px;
        flex-shrink: 0;
        letter-spacing: 0.04em;
      }

      .task-card__body {
        padding: 0 14px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .task-card__task {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.4);
        line-height: 1.4;
        border-left: 2px solid rgba(255, 255, 255, 0.08);
        padding-left: 8px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .task-card__progress-row {
        display: flex;
        justify-content: space-between;
        font-size: 0.65rem;
        color: rgba(255, 255, 255, 0.25);
      }

      .task-card__progress-bar {
        height: 4px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.07);
        overflow: hidden;
      }

      .task-card__progress-fill {
        height: 100%;
        border-radius: 2px;
        transition: width 0.8s ease;
        box-shadow: 0 0 8px currentColor;
      }

      .task-card__meta {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      .sandbox-wrap .meta-chip {
        font-size: 0.65rem;
        color: rgba(255, 255, 255, 0.35);
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        padding: 2px 8px;
        border-radius: 8px;
      }

      /* Animated working bar on active card */
      .task-card__working-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 2px;
        width: 60%;
        background: linear-gradient(90deg, transparent, #f59e0b, transparent);
        animation: scan 2.5s linear infinite;
      }

      @keyframes scan {
        0% {
          left: -60%;
        }
        100% {
          left: 100%;
        }
      }

      /* ─── Manager info card ─── */
      .sandbox-wrap .manager-info {
        padding: 12px 14px;
        margin: 12px;
        background: rgba(99, 102, 241, 0.08);
        border: 1px solid rgba(99, 102, 241, 0.25);
        border-radius: 12px;
      }

      .sandbox-wrap .manager-info__title {
        font-size: 0.7rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #818cf8;
        margin-bottom: 8px;
      }

      .sandbox-wrap .manager-info__row {
        display: flex;
        justify-content: space-between;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.4);
        margin-bottom: 4px;
      }

      .sandbox-wrap .manager-info__row span:last-child {
        color: rgba(255, 255, 255, 0.75);
        font-weight: 600;
      }

      /* ─── Empty state ─── */
      .sandbox-wrap .sidebar-empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        color: rgba(255, 255, 255, 0.2);
        font-size: 0.8rem;
        padding: 32px;
        text-align: center;
      }

      .sandbox-wrap .sidebar-empty svg {
        opacity: 0.3;
        width: 48px;
        height: 48px;
      }

      /* ─── Sandbox Empty State ─── */
      .sandbox-wrap .empty-sandbox {
        position: absolute;
        top: 40%;
        left: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        background: rgba(15, 23, 42, 0.4);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 16px;
        padding: 32px 48px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        animation: sandbox-fade-in 0.5s ease-out;
      }
      
      @keyframes sandbox-fade-in {
        from { opacity: 0; transform: translate(-50%, -45%); }
        to { opacity: 1; transform: translate(-50%, -50%); }
      }
      
      .sandbox-wrap .empty-sandbox__icon {
        font-size: 3rem;
        margin-bottom: 16px;
        opacity: 0.5;
        filter: drop-shadow(0 0 10px rgba(255,255,255,0.1));
      }
      
      .sandbox-wrap .empty-sandbox__title {
        font-size: 1.1rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.8);
        margin-bottom: 8px;
      }
      
      .sandbox-wrap .empty-sandbox__sub {
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.4);
      }

      /* ─── Task Plan Panel ─── */
      .sandbox-wrap .task-plan {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .sandbox-wrap .task-plan__desc {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.5);
        font-style: italic;
        border-left: 2px solid rgba(129, 140, 248, 0.4);
        padding-left: 8px;
      }
      .sandbox-wrap .task-plan__progress-row {
        display: flex;
        justify-content: space-between;
        font-size: 0.7rem;
        color: rgba(255, 255, 255, 0.5);
      }
      .sandbox-wrap .task-plan__bar {
        height: 6px;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 4px;
        overflow: hidden;
      }
      .sandbox-wrap .task-plan__fill {
        height: 100%;
        border-radius: 4px;
        transition: width 0.6s ease;
      }
      .sandbox-wrap .task-plan__list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .sandbox-wrap .task-plan__item {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.45);
        padding: 6px 8px;
        background: rgba(255, 255, 255, 0.03);
        border-radius: 6px;
        border-left: 2px solid rgba(255, 255, 255, 0.1);
      }
      .sandbox-wrap .task-plan__item--active {
        color: rgba(255, 255, 255, 0.9);
        background: rgba(129, 140, 248, 0.1);
        border-left-color: #818cf8;
        font-weight: 600;
      }
      .sandbox-wrap .task-plan__item--done {
        color: rgba(255, 255, 255, 0.25);
        text-decoration: line-through;
        border-left-color: rgba(16, 185, 129, 0.3);
      }
      .sandbox-wrap .task-plan__complete {
        font-size: 0.75rem;
        font-weight: 700;
        color: #10b981;
        text-align: center;
        padding: 8px;
        border: 1px solid rgba(16, 185, 129, 0.3);
        border-radius: 8px;
        background: rgba(16, 185, 129, 0.05);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .sandbox-wrap .task-plan--complete {
        border-color: rgba(16, 185, 129, 0.4);
        animation: planCompletePulse 2s ease infinite;
      }
      @keyframes planCompletePulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.2); }
        50% { box-shadow: 0 0 12px 4px rgba(16, 185, 129, 0.15); }
      }
      .sandbox-wrap .task-plan__celebrate {
        font-size: 1.2rem;
        animation: celebrateBounce 0.6s ease infinite alternate;
      }
      @keyframes celebrateBounce {
        from { transform: translateY(0); }
        to { transform: translateY(-4px); }
      }
      .sandbox-wrap .task-plan__worker-link {
        font-size: 0.65rem;
        cursor: help;
        opacity: 0.6;
        transition: opacity 0.2s;
        margin-left: 4px;
      }
      .sandbox-wrap .task-plan__worker-link:hover {
        opacity: 1;
      }
      .sandbox-wrap .task-plan__confetti {
        position: relative;
        height: 40px;
        overflow: hidden;
        pointer-events: none;
      }
      .sandbox-wrap .confetti-piece {
        position: absolute;
        left: calc(var(--x) * 1%);
        top: -8px;
        width: 6px;
        height: 6px;
        border-radius: 2px;
        background: var(--color, #818cf8);
        animation: confettiFall 2.5s ease-out var(--delay, 0s) forwards;
        opacity: 0;
      }
      @keyframes confettiFall {
        0% { opacity: 1; transform: translateY(0) rotate(0deg); }
        100% { opacity: 0; transform: translateY(48px) rotate(720deg); }
      }

      /* ─── Office Roster ─── */
      .sandbox-wrap .roster-item {
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 10px;
        margin-bottom: 8px;
        transition: background 0.2s;
      }
      .sandbox-wrap .roster-item:hover {
        background: rgba(255, 255, 255, 0.04);
      }
      .sandbox-wrap .roster-item__header {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .sandbox-wrap .roster-item__icon {
        font-size: 1.1rem;
      }
      .sandbox-wrap .roster-item__name {
        font-weight: 700;
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.9);
        flex: 1;
      }
      .sandbox-wrap .status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
      .sandbox-wrap .status-indicator--online {
        background: #10b981;
        box-shadow: 0 0 8px #10b981;
      }
      .sandbox-wrap .status-indicator--working {
        background: #f59e0b;
        box-shadow: 0 0 8px #f59e0b;
        animation: pulse-dot 1.5s ease-in-out infinite;
      }
      .sandbox-wrap .status-indicator--idle {
        background: #64748b;
      }
      .sandbox-wrap .roster-item__status {
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      /* ─── Timeline ─── */
      .sandbox-wrap .timeline-group {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .sandbox-wrap .timeline-group__title {
        font-size: 0.7rem;
        font-weight: 700;
        color: #818cf8;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-top: 8px;
        margin-bottom: -4px;
        border-bottom: 1px solid rgba(129, 140, 248, 0.2);
        padding-bottom: 4px;
      }
      .sandbox-wrap .timeline {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .sandbox-wrap .timeline__item {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        position: relative;
      }
      .sandbox-wrap .timeline__item:not(:last-child)::before {
        content: "";
        position: absolute;
        top: 14px;
        left: 5px;
        bottom: -16px;
        width: 1px;
        background: rgba(255, 255, 255, 0.1);
      }
      .sandbox-wrap .timeline__dot {
        width: 11px;
        height: 11px;沙盘不能完美的实时监视，执行任务的情况，还有一个问题就是并行处理的问题，其他问题都这里自己解决的差不多了，
        border-radius: 50%;
        margin-top: 4px;
        z-index: 1;
      }
      .sandbox-wrap .timeline__content {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .sandbox-wrap .timeline__label {
        font-size: 0.8rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.9);
      }
      .sandbox-wrap .timeline__time {
        font-size: 0.65rem;
        color: rgba(255, 255, 255, 0.4);
      }
      .sandbox-wrap .timeline__status {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-weight: 700;
      }
    </style>

    <div class="sandbox-wrap" style="--bg-gradient: ${bgGradient}; --glow-primary: ${glowPrimary}; --glow-secondary: ${glowSecondary}; --particle-opacity: ${particleOpacity};">
      <!-- Header -->
      <div class="sandbox-header">
        <div>
          <div class="sandbox-header__title">${t("sandbox.header.title")}</div>
          <div class="sandbox-header__sub">
            ${t("sandbox.header.subtitle")}
          </div>
        </div>
        <div class="sandbox-header__stats">
          <div class="stat-chip" style="border-color: ${healthColor}40;">
            <div class="stat-chip__dot" style="background: ${healthColor}; box-shadow: 0 0 6px ${healthColor}; animation: ${healthPercent < 100 ? 'pulse-dot 1s infinite' : 'none'};"></div>
            ${t("sandbox.header.health", { percent: String(healthPercent), status: healthStatus })}
          </div>
          <div class="stat-chip">
            <div class="stat-chip__dot stat-chip__dot--busy"></div>
            ${t("sandbox.header.busy", { count: String(totalBusy) })}
          </div>
          <div class="stat-chip">
            <div class="stat-chip__dot stat-chip__dot--idle"></div>
            ${t("sandbox.header.idle", { count: String(totalIdle) })}
          </div>
          <div class="stat-chip">
            <div class="stat-chip__dot stat-chip__dot--total"></div>
            ${totalTokens.toLocaleString()} Tokens
          </div>
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "⟳" : "↺"}
          </button>
          ${props.onForceRestart 
            ? html`<button class="btn" style="border-color: rgba(239, 68, 68, 0.4); color: #ef4444;" @click=${props.onForceRestart} title="${t("sandbox.header.forceRestartTitle")}">${t("sandbox.header.forceRestart")}</button>` 
            : nothing}
        </div>
      </div>

      ${
        props.error
          ? html`<div
            class="callout danger"
            style="margin: 12px; border-radius: 8px;"
          >
            ${props.error}
          </div>`
          : nothing
      }

      <!-- Body: Sidebar (Left) + Stage (Right) -->
      <div class="sandbox-body">
        <!-- Sidebar: Task Cards & Roster -->
        <div class="sandbox-sidebar">
          
          <!-- Main Agent Task Plan -->
          <div class="sandbox-sidebar-header">${t("sandbox.sidebar.blueprints")}</div>
          <div class="sidebar-cards" style="padding: 12px;">
            ${renderTaskPlanPanel(props.taskPlan, activeSessions)}
          </div>

          <!-- Active Task Cards (Detailed Progress) -->
          ${
            activeSessions.length > 0
              ? html`
                  <div class="sandbox-sidebar-header">${t("sandbox.sidebar.activeProgress")}</div>
                `
              : nothing
          }
          ${
            activeSessions.length > 0
              ? html`
                  <div class="sidebar-cards">
                    ${activeSessions.map((row, i) => renderTaskCard(row, i))}
                  </div>
                `
              : nothing
          }

          <!-- Office Roster (Team Status) -->
          <div class="sandbox-sidebar-header">${t("sandbox.sidebar.roster")}</div>
          <div class="sidebar-cards">
            <!-- Main Agent Online Status -->
            <div class="roster-item">
              <div class="roster-item__header">
                <span class="roster-item__icon">👑</span>
                <span class="roster-item__name">${t("sandbox.sidebar.elder")}</span>
                <div class="status-indicator status-indicator--online"></div>
                <span class="roster-item__status">${t("sandbox.sidebar.online")}</span>
              </div>
              <div class="roster-item__meta" style="margin-top: 6px; font-size: 0.75rem; color: rgba(255,255,255,0.6);">
                ${globalSession?.model ? `Brain: ${globalSession.model}` : t("sandbox.sidebar.orchestrating")}
              </div>
            </div>

            <!-- Active Workers -->
            ${
              activeSessions.length === 0
                ? html`
                    <div class="sidebar-empty" style="margin-top: 8px">
                      <span>${t("sandbox.sidebar.noWorkers")}</span>
                    </div>
                  `
                : activeSessions.map((row) => {
                    const isWorking = row.outputTokens && row.outputTokens > 0;
                    return html`
                      <div class="roster-item">
                        <div class="roster-item__header">
                          <span class="roster-item__icon">🦞</span>
                          <span class="roster-item__name">${row.label || row.key.slice(0, 10)}</span>
                          <div class="status-indicator ${isWorking ? "status-indicator--working" : "status-indicator--idle"}"></div>
                          <span class="roster-item__status" style="color: ${sessionStatusColor(row)}">${sessionStatusLabel(row)}</span>
                        </div>
                        ${row.subject ? html`<div class="roster-item__subject" style="margin-top: 6px; font-size: 0.8rem; color: rgba(255,255,255,0.85);">${row.subject}</div>` : nothing}
                      </div>
                    `;
                  })
            }
          </div>

          <!-- History Timeline -->
          <div class="sandbox-sidebar-header">${t("sandbox.sidebar.history")}</div>
          <div class="sidebar-cards" style="padding: 12px;">
            ${renderTimeline(rows)}
          </div>
        </div>

        <!-- 3D Stage -->
        <div class="sandbox-stage">
          <div class="sandbox-grid"></div>
          <div class="stage-particles"></div>

          <!-- Office Zones -->
          <div class="zone zone--hq" data-label="Headquarters">
            <div class="prop prop-server ${isNight ? "prop-server-active" : ""}"></div>
          </div>
          <div class="zone zone--dev" data-label="App Development Lab">
            <div class="prop prop-anvil ${totalBusy > 0 ? "prop-anvil-active" : ""}">
              <div class="anvil-body"></div>
            </div>
          </div>
          <div class="zone zone--cafe" data-label="Coffee Lounge">
            <div class="prop prop-table"></div>
          </div>

          <!-- Pipeline Conveyor Belt -->
          <div class="pipeline">
            <div class="pipeline__belt"></div>
            ${(props.taskPlan?.todos || []).map((todo, idx, arr) => {
              const total = arr.length;
              const isDone = todo.status === "done";
              const isActive = todo.status === "in_progress";
              const isTodo = todo.status === "todo";
              
              // Calculate horizontal position on the belt
              let leftPos = "10%";
              
              if (isTodo) {
                // Stack on the left (0% to 30%)
                const todoItems = arr.filter(t => t.status === "todo");
                const myTodoIdx = todoItems.findIndex(t => t.id === todo.id);
                leftPos = `${5 + (myTodoIdx * (30 / Math.max(1, todoItems.length)))}%`;
              } else if (isActive) {
                // Active items near the center (45% to 55%)
                leftPos = "50%";
              } else if (isDone) {
                // Stack on the right (70% to 95%)
                const doneItems = arr.filter(t => t.status === "done");
                const myDoneIdx = doneItems.findIndex(t => t.id === todo.id);
                leftPos = `${70 + (myDoneIdx * (25 / Math.max(1, doneItems.length)))}%`;
              }

              const cls = isDone ? "pipeline-task--done" : isActive ? "pipeline-task--active" : "pipeline-task--todo";
              const icon = isDone ? "✅" : isActive ? "🔥" : "📦";
              
              return html`
                <div class="pipeline-task ${cls}" style="left: ${leftPos}; z-index: ${100 - idx};">
                  ${icon}
                  <div class="pipeline-task__label">${todo.title.slice(0, 20)}${todo.title.length > 20 ? '...' : ''}</div>
                </div>
              `;
            })}
          </div>

          <!-- Manager Agent — HQ -->
          <div class="agent-slot" style="top: 25%; left: 50%; transform: translate(-50%, -50%); z-index: 20;">
            ${(function () {
              if (globalSession && totalBusy > 0 && globalSession.subject) {
                const message = props.sandboxChatEvents?.[globalSession.key];
                if (message) {
                  const cards = extractToolCards(message);
                  if (cards.length > 0) {
                    return html`<div class="chat-bubble chat-bubble--cards">
                      ${cards.map((card) => renderToolCardSidebar(card))}
                    </div>`;
                  }
                }
                return html`<div class="chat-bubble">💬 ${globalSession.subject}</div>`;
              }
              return nothing;
            })()}
            ${renderManagerFigure(totalBusy > 0)}
            <div class="agent-name-tag" data-hover-task="${globalSession?.subject || t("sandbox.stage.managerHover")}">${t("sandbox.stage.managerLabel")}</div>
            <div
              class="agent-status-dot ${
                totalBusy > 0 ? "agent-status-dot--working" : "agent-status-dot--idle"
              }"
            ></div>
          </div>

          <!-- Subagents — Dispatched to correct rooms -->
          ${
            activeSessions.length === 0
              ? html`
                  <div class="empty-sandbox">
                    <div class="empty-sandbox__icon">🦞🏝️</div>
                    <div class="empty-sandbox__title">${t("sandbox.stage.quiet")}</div>
                    <div class="empty-sandbox__sub">${t("sandbox.stage.runComplex")}</div>
                  </div>
                `
              : activeSessions.map((row, i) => {
                  const isWorking = Boolean(row.outputTokens && row.outputTokens > 0);

                  // Count workers in each state for even distribution
                  const workingRows = activeSessions.filter((r) => Boolean(r.outputTokens && r.outputTokens > 0));
                  const idleRows = activeSessions.filter((r) => !r.outputTokens || r.outputTokens === 0);
                  const myGroup = isWorking ? workingRows : idleRows;
                  const myIndexInGroup = myGroup.indexOf(row);
                  const groupSize = myGroup.length;

                  // Enlarged zones with better spread
                  let targetZone = { cx: 50, cy: 55, radiusX: 28, radiusY: 18 }; // Default
                  if (isWorking) {
                    if (myIndexInGroup % 2 === 0) {
                      targetZone = { cx: 28, cy: 62, radiusX: 22, radiusY: 14 }; // Dev Lab (left)
                    } else {
                      targetZone = { cx: 50, cy: 72, radiusX: 20, radiusY: 12 }; // Research Bay (center-bottom)
                    }
                  } else {
                    targetZone = { cx: 75, cy: 62, radiusX: 20, radiusY: 14 }; // Coffee Lounge (right)
                  }

                  // Index-based even angular distribution instead of hash collision
                  const hashOffset = String(row.key)
                    .split("")
                    .reduce((acc, char) => acc + char.charCodeAt(0), 0) * 0.01;
                  const sameZoneCount = isWorking
                    ? Math.ceil(groupSize / 2) // Split across 2 zones
                    : groupSize;
                  const sameZoneIndex = isWorking
                    ? Math.floor(myIndexInGroup / 2)
                    : myIndexInGroup;
                  const angle =
                    sameZoneCount > 0
                      ? (sameZoneIndex / sameZoneCount) * 2 * Math.PI + hashOffset
                      : hashOffset;

                  // More varied radius to prevent ring clusters
                  const varyRadius = 0.55 + ((sameZoneIndex % 3) * 0.2); // 0.55, 0.75, 0.95

                  const finalCx =
                    targetZone.cx + Math.cos(angle) * (targetZone.radiusX * varyRadius);
                  const finalCy =
                    targetZone.cy + Math.sin(angle) * (targetZone.radiusY * varyRadius);

                  // Calculate facing direction
                  let facingLeft = false;
                  const prev = prevPositions[row.key];
                  if (prev) {
                    // If moving left (decreasing X), face left
                    if (finalCx < prev.cx - 0.5) {
                      facingLeft = true;
                    } else if (finalCx > prev.cx + 0.5) {
                      facingLeft = false;
                    } else {
                      // Stay same direction if barely moved
                      facingLeft = prev.facingLeft;
                    }
                  }

                  // Save current for next tick
                  prevPositions[row.key] = { cx: finalCx, cy: finalCy, facingLeft };

                  const dotClass = row.abortedLastRun
                    ? "agent-status-dot--aborted"
                    : isWorking
                      ? "agent-status-dot--working"
                      : "agent-status-dot--idle";

                  const transformFlip = facingLeft ? "scaleX(-1)" : "scaleX(1)";

                  return html`
                  <div
                    class="agent-slot"
                    style="top: ${finalCy}%; left: ${finalCx}%; transform: translate(-50%, -50%); z-index: ${Math.round(finalCy)};"
                    title="${row.label || row.key}"
                  >
                    ${(function () {
                      if (isWorking && row.subject) {
                        const message = props.sandboxChatEvents?.[row.key];
                        if (message) {
                          const cards = extractToolCards(message);
                          if (cards.length > 0) {
                            return html`<div class="chat-bubble chat-bubble--cards">
                              ${cards.map((card) => renderToolCardSidebar(card))}
                            </div>`;
                          }
                        }
                        return html`<div class="chat-bubble">💬 ${row.subject}</div>`;
                      }
                      return nothing;
                    })()}
                    <div style="transform: ${transformFlip}; transition: transform 0.4s ease;">
                      ${renderWorkerFigure(row)}
                    </div>
                    <!-- Added interactive hover card data attribute for CSS tooltips -->
                    <div class="agent-name-tag" data-hover-task="${row.subject || t("sandbox.stage.waiting")}">🦞 ${row.label || row.key.slice(0, 10)}</div>
                    <div class="agent-status-dot ${dotClass}"></div>
                  </div>
                `;
                })
          }
        </div>
      </div>
    </div>
  `;
}
