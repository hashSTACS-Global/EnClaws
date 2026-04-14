-- ============================================================
-- 009: Customer Service tables
-- ============================================================

-- Sessions (会话)
CREATE TABLE IF NOT EXISTS cs_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  visitor_id      VARCHAR(128) NOT NULL,
  visitor_name    VARCHAR(255),
  state           VARCHAR(32)  NOT NULL DEFAULT 'ai_active',
  channel         VARCHAR(32)  NOT NULL DEFAULT 'web_widget',
  tags            JSONB        NOT NULL DEFAULT '[]',
  identity_anchors JSONB       NOT NULL DEFAULT '{}',
  metadata        JSONB        NOT NULL DEFAULT '{}',
  assigned_to     UUID         REFERENCES users(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cs_sessions_tenant ON cs_sessions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cs_sessions_state ON cs_sessions(tenant_id, state) WHERE closed_at IS NULL;

-- Messages (消息 — 三方对话)
CREATE TABLE IF NOT EXISTS cs_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID         NOT NULL REFERENCES cs_sessions(id) ON DELETE CASCADE,
  tenant_id       UUID         NOT NULL,
  role            VARCHAR(16)  NOT NULL,
  content         TEXT         NOT NULL,
  confidence      JSONB,
  feedback_type   VARCHAR(32),
  source_chunks   JSONB,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_messages_session ON cs_messages(session_id, created_at);
