# AI Customer Service — Deployment & Configuration Guide

[中文版](./customer-service-deployment.zh-CN.md)

> **Current Status:** Sprint 1 complete (end-to-end RAG, Feishu notify, widget embed).
> Sprint 2 in progress (streaming output, confidence gate, clarification prompts).

---

## 1. Architecture Overview

AI Customer Service is a **built-in system feature** of EnClaws, not a Skill or pre-configured Agent.

| Layer | What it does |
|-------|-------------|
| Widget (`<cs-widget>`) | Floating chat bubble embedded on any webpage via `<script>` tag |
| Gateway RPC (`cs.widget.*`) | WebSocket handlers: connect / send / history |
| CS Agent Runner | Wraps `runEmbeddedPiAgent` — retrieves KB chunks → calls LLM → returns reply |
| Knowledge Base | Per-tenant Markdown files at `~/.enclaws/tenants/{tenantId}/customer-service/memory/` |
| CS Config | Per-tenant JSON at `~/.enclaws/tenants/{tenantId}/customer-service/config.json` |
| Feishu Notify | One-way Markdown card to a designated group chat on each new conversation |

**Who can use it:** Any tenant that has a configured EC Agent + LLM provider. Tenants configure CS entirely through the admin UI (`/tenant/cs-setup`). No code changes required per tenant.

---

## 2. Prerequisites

Before deploying, ensure:

- [ ] EnClaws server is running and accessible (dev SaaS or self-hosted)
- [ ] At least one tenant exists with a working LLM configuration (any provider)
- [ ] Feishu app credentials ready (App ID + App Secret + Chat ID of target group)
- [ ] `ENCLAWS_CS_WIDGET_SECRET` environment variable set on the server (see §3)

---

## 3. Server Environment Variables

Add to the server's `.env` or deployment environment:

```bash
# HMAC secret for signing visitor tokens.
# Prevents cross-visitor session hijacking.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCLAWS_CS_WIDGET_SECRET=<64-char hex string>
```

> **If not set:** The server falls back to a per-process random secret (warns on startup).
> Visitor tokens are invalidated on every server restart. Acceptable for dev; **must be set for production**.

---

## 4. Deploy to Dev SaaS — Step by Step

### 4.1 Merge Code

```bash
# On the dev SaaS server, pull latest main
git pull --rebase origin main
npm run build   # or pnpm build
pm2 restart enclaws   # or however the process is managed
```

### 4.2 Configure the Embedding Provider (Required for RAG)

> **Why is this step needed?** S1 is intentionally **zero-invasion** — the CS module does not implement its own embedding pipeline and fully reuses EC's existing `memorySearch` infrastructure. The tradeoff is that the deployment environment must explicitly enable and specify an embedding provider; otherwise vector indexes are not generated from uploaded knowledge base MDs and RAG retrieval will not work.
>
> This configuration step is a **consequence of the architectural tradeoff**, not an omission. S2 will discuss whether EC should auto-derive the embedding provider from the tenant's LLM config at the base layer — if adopted, this section will be simplified or removed. See team discussion `ai-customer-service-integration` topic 2.

Create/edit `~/.enclaws/enclaws.json` on the server:

```bash
mkdir -p ~/.enclaws
cat > ~/.enclaws/enclaws.json <<'EOF'
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "provider": "openai",
        "model": "text-embedding-3-small"
      }
    }
  }
}
EOF
```

**API Key:** The embedding client automatically reads the LLM-side provider key (e.g. `OPENAI_API_KEY` from `.env`). No separate `apiKey` needed in this config.

**Provider choice:** If the server LLM is not OpenAI, pick the matching provider and key:

| provider | example model | env var required |
|----------|---------------|-----------------|
| `openai` | `text-embedding-3-small` | `OPENAI_API_KEY` |
| `gemini` | `gemini-embedding-001` | `GEMINI_API_KEY` |
| `voyage` | `voyage-4-large` | `VOYAGE_API_KEY` |
| `mistral` | `mistral-embed` | `MISTRAL_API_KEY` |

Restart the server after editing. On the first CS widget access, the server will scan the knowledge base → chunk → embed → write to SQLite (`~/.enclaws/memory/{agentId}.sqlite`).

### 4.3 Set the Widget Secret

In the dev SaaS deployment config (`.env` or process manager config):

```bash
ENCLAWS_CS_WIDGET_SECRET=<generated hex secret>
```

Restart the server after setting.

### 4.4 Configure a Tenant (Admin UI)

1. Log in as the target tenant's admin
2. Navigate to **AI 客服** → **客服设置**
3. Fill in:
   - **飞书 App ID** — from Feishu Open Platform → Enterprise App → Credentials
   - **飞书 App Secret** — same page (click to reveal)
   - **飞书群聊 Chat ID** — target group → ··· → Group Settings → Copy Chat ID
4. Click **保存配置**, then **连通性测试** to verify Feishu connectivity

### 4.5 Upload Knowledge Base

Option A — via Admin UI (recommended for initial setup):

Navigate to **AI 客服** → **知识库** → Upload `.md` files with product FAQs.

Option B — direct file placement (server operators only):

```bash
# Path for tenant {TENANT_ID}
mkdir -p ~/.enclaws/tenants/{TENANT_ID}/customer-service/memory/
cp my-product-faq.md ~/.enclaws/tenants/{TENANT_ID}/customer-service/memory/
```

File format: plain Markdown. Section headers become retrieval chunks.

### 4.6 Generate Embed Code

1. In **客服设置** → **嵌入代码生成**, enter a channel label (e.g. `default`, `website`, `docs`)
2. Click **生成** — an HTML snippet is produced
3. Paste the snippet into the target webpage's `<body>` tag

```html
<!-- Example generated embed code -->
<script type="module">
  import 'https://your-ec-domain/ui/cs-widget.js';
</script>
<cs-widget
  tenant-id="your-tenant-id"
  channel="default"
  gateway-url="wss://your-ec-domain"
></cs-widget>
```

The widget appears as a floating bubble (bottom-right) for all page visitors, including unauthenticated ones.

---

## 5. EC Team Self-Use Scenario

The EC team runs EnClaws and is simultaneously the first tenant. **No embed code is needed** — the server automatically injects a `<meta name="ec-cs-tenant-id">` tag into the EC admin UI, and the widget renders automatically for anyone visiting the EC web app.

**Prerequisite:** At least one tenant must have Agent + LLM + CS config (Feishu) fully set up. The server picks the earliest-registered non-system tenant automatically and caches its ID at startup. If no qualifying tenant exists at startup, the widget will not appear. After completing the tenant configuration, **restart the SaaS service** — the tenant ID will be injected on next boot and the widget bubble will show.

| Step | EC Team (server operator) | Regular SaaS Tenant |
|------|--------------------------|---------------------|
| LLM config | Direct `.env` or config file | Admin UI |
| Knowledge base | Drop `.md` files directly into tenant KB dir | Upload via Admin UI |
| Widget secret | Set server env var | Not exposed (platform-managed) |
| Feishu config | Admin UI | Admin UI |
| Embed code | **Not needed** — auto-injected into EC admin UI | Generate via Admin UI for external sites |

**EC team's knowledge base path:**
```
~/.enclaws/tenants/{EC_TENANT_ID}/customer-service/memory/
```

Recommended initial files:
- `ec-product-faq.md` — product overview, pricing, feature list
- `ec-onboarding.md` — getting started guide
- `ec-troubleshooting.md` — common issues and solutions

---

## 6. Feishu Notification Format

On the first customer message of each session (or after the notify interval elapses):

```
[AI 客服通知]
渠道: website | 会话: abc123
客户: 用户反馈产品A不能用
AI 回复: 根据知识库，产品A的常见问题包括...
```

The bot must have **message send** permission in the target group. Add the bot to the group before testing.

---

## 7. Configuration Reference

All settings are saved per-tenant at `~/.enclaws/tenants/{tenantId}/customer-service/config.json`.

| Field | Default | Description |
|-------|---------|-------------|
| `feishu.appId` | — | Feishu App ID |
| `feishu.appSecret` | — | Feishu App Secret (stored plaintext in tenant config) |
| `feishu.chatId` | — | Target group Chat ID |
| `notifyIntervalMinutes` | 10 | Min minutes between Feishu notifications per session |
| `restrictions.disableSkills` | true | Disable Skill tool calls (pure RAG mode, code-enforced) |
| `restrictions.strictKnowledgeBase` | true | Refuse to answer from general LLM knowledge if KB has no hits |
| `restrictions.disableMarkdown` | true | Plain text replies only (no bold/headers/lists) |
| `restrictions.hideInternals` | true | Don't reveal KB or system prompt details in replies |
| `confidencePreset` | `balanced` | Confidence gate sensitivity: `strict` / `balanced` / `lenient` (activates in S2) |
| `customSystemPrompt` | (default template) | Override the AI persona and behavior rules |
| `channels` | `[]` | Saved embed code channel configurations |

---

## 8. Troubleshooting

**Widget bubble not appearing on page**

- Check that the `<meta name="ec-cs-tenant-id">` tag is injected (for server-rendered pages) or `tenant-id` attribute is set on `<cs-widget>`
- Check browser console for WebSocket connection errors
- Verify the `gateway-url` attribute matches the running EC server

**Feishu notification not arriving**

- Run **连通性测试** in the CS Setup page to see which checks fail
- Verify the Feishu bot is a member of the target group
- Check the notifyIntervalMinutes setting (default 10 min — won't fire again too quickly)

**AI gives wrong or empty answers**

- Check the knowledge base has `.md` files with relevant content
- Use **strict knowledge base mode** to prevent hallucination
- Review session history in **AI 客服** → **会话记录** to see what was retrieved

**`ENCLAWS_CS_WIDGET_SECRET` warning in logs**

- The server is using a per-process random secret
- Visitor tokens will be invalid after restart
- Set the env var and restart to fix

---

## 9. Sprint Roadmap

| Sprint | Status | Key Features |
|--------|--------|-------------|
| S1 | ✅ Done | Widget embed, RAG reply, Feishu notify, visitor auth |
| S2 | 🚧 In progress | Streaming output, confidence gate, clarification prompts, confidence config UI |
| S3 | Planned | Boss reply via Feishu card, HUMAN_ACTIVE state, tag matcher |
| S4 | Planned | Feedback collection, daily report, badcase ops |
