-- ============================================================
-- EnClaws Multi-Tenant Schema
-- ============================================================

-- Extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Drop all tables (reverse dependency order)
-- ============================================================
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
DROP TABLE IF EXISTS _migrations CASCADE;
DROP TABLE IF EXISTS llm_interaction_traces CASCADE;
DROP TABLE IF EXISTS usage_records CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS tenant_agents CASCADE;
DROP TABLE IF EXISTS tenant_channel_apps CASCADE;
DROP TABLE IF EXISTS tenant_channels CASCADE;
DROP TABLE IF EXISTS tenant_api_keys CASCADE;
DROP TABLE IF EXISTS tenant_models CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;
DROP TABLE IF EXISTS sys_gateway_config CASCADE;
DROP TABLE IF EXISTS sys_logging_config CASCADE;
DROP TABLE IF EXISTS sys_plugins_config CASCADE;
DROP TABLE IF EXISTS sys_tools_config CASCADE;

-- ============================================================
-- 1. Tenants (租户/企业)
-- ============================================================
CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(128) NOT NULL UNIQUE,       -- URL-safe identifier
  plan        VARCHAR(64)  NOT NULL DEFAULT 'free', -- free | pro | enterprise
  status      VARCHAR(32)  NOT NULL DEFAULT 'active', -- active | suspended | deleted
  settings    JSONB        NOT NULL DEFAULT '{}',  -- tenant-level settings overrides
  quotas      JSONB        NOT NULL DEFAULT '{
    "maxUsers": 5,
    "maxAgents": 3,
    "maxChannels": 5,
    "maxTokensPerMonth": 1000000
  }',   -- resource quotas
  trace_enabled    BOOLEAN      NOT NULL DEFAULT true,  -- LLM交互追踪开关
  identity_prompt  TEXT         NOT NULL DEFAULT '',   -- 企业身份特征描述
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants (slug);
CREATE INDEX idx_tenants_status ON tenants (status);

-- ============================================================
-- 2. Users (用户)
-- ============================================================
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  open_ids    VARCHAR(255)[] DEFAULT '{}',
  union_id    VARCHAR(255),
  email       VARCHAR(320),
  password_hash VARCHAR(255),
  display_name VARCHAR(255),
  role        VARCHAR(32)  NOT NULL DEFAULT 'member', -- owner | admin | member | viewer
  status      VARCHAR(32)  NOT NULL DEFAULT 'active', -- active | invited | suspended | deleted
  avatar_url  VARCHAR(1024),
  last_login_at TIMESTAMPTZ,
  channel_id  UUID,
  settings    JSONB        NOT NULL DEFAULT '{}',  -- user-level preferences
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_tenant ON users (tenant_id);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_status ON users (tenant_id, status);
CREATE INDEX idx_users_open_ids ON users USING GIN (open_ids) WHERE open_ids IS NOT NULL;
CREATE INDEX idx_users_union_id ON users (union_id) WHERE union_id IS NOT NULL;
CREATE INDEX idx_users_channel ON users (channel_id) WHERE channel_id IS NOT NULL;

-- ============================================================
-- 3. API Keys (租户级 AI 提供商密钥)
-- ============================================================
CREATE TABLE tenant_api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider    VARCHAR(64)  NOT NULL,   -- openai | anthropic | gemini | ...
  label       VARCHAR(255),            -- user-friendly name
  key_encrypted TEXT       NOT NULL,   -- encrypted API key
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  usage_count BIGINT       NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_tenant ON tenant_api_keys (tenant_id, provider);

-- ============================================================
-- 4. Channel Configs (租户级渠道配置)
-- ============================================================
CREATE TABLE tenant_channels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_type    VARCHAR(64)  NOT NULL,    -- telegram | discord | slack | feishu | ...
  channel_name    VARCHAR(255),             -- 频道名称
  channel_policy  VARCHAR(32)  NOT NULL DEFAULT 'open', -- open | allowlist | disabled
  config          JSONB        NOT NULL DEFAULT '{}',
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, channel_type, channel_name)
);

CREATE INDEX idx_channels_tenant ON tenant_channels (tenant_id);

-- Deferred FK: users.channel_id → tenant_channels (avoids circular dependency)
ALTER TABLE users ADD CONSTRAINT fk_users_channel
  FOREIGN KEY (channel_id) REFERENCES tenant_channels(id) ON DELETE SET NULL;

-- ============================================================
-- 5. Channel Apps (频道下的应用配置)
-- ============================================================
CREATE TABLE tenant_channel_apps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id   UUID         NOT NULL REFERENCES tenant_channels(id) ON DELETE CASCADE,
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  app_id       VARCHAR(255) NOT NULL,
  app_secret   VARCHAR(512) NOT NULL DEFAULT '',
  bot_name     VARCHAR(255) NOT NULL DEFAULT '',
  group_policy VARCHAR(32)  NOT NULL DEFAULT 'open', -- open | allowlist | disabled
  agent_id     VARCHAR(128),                         -- bound agent logical ID (one-to-many: one agent can bind multiple apps)
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(channel_id, app_id)
);

CREATE INDEX idx_channel_apps_channel ON tenant_channel_apps (channel_id);
CREATE INDEX idx_channel_apps_tenant ON tenant_channel_apps (tenant_id);
CREATE INDEX idx_channel_apps_agent ON tenant_channel_apps (agent_id) WHERE agent_id IS NOT NULL;

-- ============================================================
-- 6. Tenant Models (租户级模型配置)
-- ============================================================
CREATE TABLE tenant_models (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_type VARCHAR(64)  NOT NULL,   -- openai | anthropic | deepseek | qwen | ollama | custom ...
  provider_name VARCHAR(255) NOT NULL,   -- user-friendly provider label
  base_url      VARCHAR(1024),           -- API endpoint (required for custom/ollama)
  api_protocol  VARCHAR(64)  NOT NULL DEFAULT 'openai-completions', -- openai-completions | anthropic-messages | ...
  auth_mode     VARCHAR(32)  NOT NULL DEFAULT 'api-key',  -- api-key | oauth | token | none
  api_key_encrypted TEXT,                -- encrypted API key (null for oauth/none)
  extra_headers JSONB        NOT NULL DEFAULT '{}',  -- custom headers
  extra_config  JSONB        NOT NULL DEFAULT '{}',  -- provider-specific config (accountId, gatewayId, endpoint variant, etc.)
  models        JSONB        NOT NULL DEFAULT '[]',  -- array of model definitions [{id, name, reasoning, input, contextWindow, maxTokens, cost, compat}]
  visibility    VARCHAR(16)  NOT NULL DEFAULT 'private', -- private (tenant-only) | shared (visible to all tenants)
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  created_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenant_models_tenant ON tenant_models (tenant_id);
CREATE INDEX idx_tenant_models_active ON tenant_models (tenant_id, is_active) WHERE is_active = true;
CREATE INDEX idx_tenant_models_shared ON tenant_models (visibility, is_active) WHERE visibility = 'shared' AND is_active = true;

-- ============================================================
-- 7. Agent Configs (租户级 Agent 配置) — references tenant_models
-- ============================================================
CREATE TABLE tenant_agents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id       VARCHAR(128) NOT NULL,   -- logical agent ID (e.g., "main", "kimi")
  name           VARCHAR(255) NOT NULL,
  config         JSONB        NOT NULL DEFAULT '{}', -- full agent config
  model_config   JSONB        NOT NULL DEFAULT '[]', -- [{providerId, modelId, isDefault}] ordered list; isDefault=true is primary, rest are fallbacks
  is_active      BOOLEAN      NOT NULL DEFAULT true,
  created_by     UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, agent_id)
);

CREATE INDEX idx_agents_tenant ON tenant_agents (tenant_id);

-- ============================================================
-- 7. Refresh Tokens (JWT 刷新令牌)
-- ============================================================
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,
  device_info VARCHAR(512),
  expires_at  TIMESTAMPTZ  NOT NULL,
  revoked     BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash);

-- ============================================================
-- 9. Audit Logs (操作审计)
-- ============================================================
CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID         REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(128) NOT NULL,   -- e.g., "user.login", "agent.create", "config.update"
  resource    VARCHAR(128),            -- e.g., "agent:main", "channel:telegram"
  detail      JSONB        DEFAULT '{}',
  ip_address  VARCHAR(45),
  user_agent  VARCHAR(1024),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX idx_audit_user ON audit_logs (user_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs (tenant_id, action);

-- ============================================================
-- 10. Usage Tracking (用量统计)
-- ============================================================
CREATE TABLE usage_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     VARCHAR(64),
  agent_id    VARCHAR(128),
  provider    VARCHAR(64),
  model       VARCHAR(128),
  input_tokens  BIGINT     NOT NULL DEFAULT 0,
  output_tokens BIGINT     NOT NULL DEFAULT 0,
  cache_read_tokens BIGINT NOT NULL DEFAULT 0,
  cache_write_tokens BIGINT NOT NULL DEFAULT 0,
  session_key VARCHAR(512),
  recorded_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_tenant_time ON usage_records (tenant_id, recorded_at DESC);
CREATE INDEX idx_usage_user ON usage_records (tenant_id, user_id, recorded_at DESC);

-- ============================================================
-- 11. LLM Interaction Traces (LLM交互追踪)
-- ============================================================
CREATE TABLE llm_interaction_traces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       VARCHAR(255),
  session_key   VARCHAR(512),
  agent_id      VARCHAR(128),
  channel       VARCHAR(128),

  -- 用户轮次分组: 同一次用户提问共享相同turn_id
  turn_id       UUID         NOT NULL,
  turn_index    SMALLINT     NOT NULL DEFAULT 0,

  -- 用户原始输入 (仅 turn_index=0 时填充)
  user_input    TEXT,

  -- LLM请求
  provider      VARCHAR(64),
  model         VARCHAR(128),
  system_prompt TEXT,
  messages      JSONB        NOT NULL DEFAULT '[]',
  tools         JSONB,
  request_params JSONB,

  -- LLM响应
  response      JSONB,
  stop_reason   VARCHAR(64),
  error_message TEXT,

  -- Token用量
  input_tokens    BIGINT     NOT NULL DEFAULT 0,
  output_tokens   BIGINT     NOT NULL DEFAULT 0,
  cache_read_tokens  BIGINT  NOT NULL DEFAULT 0,
  cache_write_tokens BIGINT  NOT NULL DEFAULT 0,

  -- 时间
  duration_ms   INT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_traces_tenant_time ON llm_interaction_traces (tenant_id, created_at DESC);
CREATE INDEX idx_traces_session ON llm_interaction_traces (tenant_id, session_key, created_at);
CREATE INDEX idx_traces_turn ON llm_interaction_traces (turn_id);
CREATE INDEX idx_traces_user ON llm_interaction_traces (user_id, created_at DESC);
CREATE INDEX idx_traces_agent ON llm_interaction_traces (tenant_id, agent_id, created_at DESC);

-- ============================================================
-- 12. System Gateway Config (single-row)
-- ============================================================
CREATE TABLE IF NOT EXISTS sys_gateway_config (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  port                     INTEGER NOT NULL DEFAULT 18888,
  mode                     VARCHAR(32) DEFAULT 'local',
  bind                     VARCHAR(32) DEFAULT 'lan',
  custom_bind_host         VARCHAR(255),
  tailscale                JSONB NOT NULL DEFAULT '{}',
  remote                   JSONB NOT NULL DEFAULT '{}',
  reload                   JSONB NOT NULL DEFAULT '{}',
  tls                      JSONB NOT NULL DEFAULT '{}',
  http                     JSONB NOT NULL DEFAULT '{}',
  nodes                    JSONB NOT NULL DEFAULT '{}',
  trusted_proxies          JSONB NOT NULL DEFAULT '[]',
  allow_real_ip_fallback   BOOLEAN NOT NULL DEFAULT false,
  auth                     JSONB NOT NULL DEFAULT '{"mode":"token","token":"70b8b8d138fcb84242a83aa69db615286a2977020a2efe73"}',
  tools                    JSONB NOT NULL DEFAULT '{}',
  channel_health_check_minutes INTEGER DEFAULT 5,
  multi_tenant             JSONB NOT NULL DEFAULT '{"enabled":true}',
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO sys_gateway_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================================
-- 13. System Logging Config (single-row)
-- ============================================================
CREATE TABLE IF NOT EXISTS sys_logging_config (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  level                    VARCHAR(32) DEFAULT 'info',
  file                     VARCHAR(1024),
  max_file_bytes           INTEGER,
  console_level            VARCHAR(32),
  console_style            VARCHAR(32),
  redact_sensitive         VARCHAR(32) DEFAULT 'tools',
  redact_patterns          JSONB NOT NULL DEFAULT '[]',
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO sys_logging_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================================
-- 14. System Plugins Config (single-row)
-- ============================================================
CREATE TABLE IF NOT EXISTS sys_plugins_config (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  enabled                  BOOLEAN NOT NULL DEFAULT true,
  allow                    JSONB NOT NULL DEFAULT '["openclaw-lark"]',
  deny                     JSONB NOT NULL DEFAULT '[]',
  load                     JSONB NOT NULL DEFAULT '{}',
  slots                    JSONB NOT NULL DEFAULT '{}',
  entries                  JSONB NOT NULL DEFAULT '{"openclaw-lark":{"enabled":true}}',
  installs                 JSONB NOT NULL DEFAULT '{}',
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO sys_plugins_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================================
-- 14b. System Tools Config (single-row)
-- ============================================================
CREATE TABLE IF NOT EXISTS sys_tools_config (
  id                             INTEGER PRIMARY KEY CHECK (id = 1),
  allow_dangerous_tools_override BOOLEAN NOT NULL DEFAULT false,
  profile                        VARCHAR(32) DEFAULT 'full',
  allow                          JSONB NOT NULL DEFAULT '[]',
  also_allow                     JSONB NOT NULL DEFAULT '[]',
  deny                           JSONB NOT NULL DEFAULT '[]',
  by_provider                    JSONB NOT NULL DEFAULT '{}',
  web                            JSONB NOT NULL DEFAULT '{"search":{"enabled":false}}',
  media                          JSONB NOT NULL DEFAULT '{}',
  links                          JSONB NOT NULL DEFAULT '{}',
  message                        JSONB NOT NULL DEFAULT '{}',
  agent_to_agent                 JSONB NOT NULL DEFAULT '{}',
  sessions                       JSONB NOT NULL DEFAULT '{}',
  elevated                       JSONB NOT NULL DEFAULT '{}',
  exec                           JSONB NOT NULL DEFAULT '{"security":"full","ask":"off","backgroundMs":600000}',
  fs                             JSONB NOT NULL DEFAULT '{}',
  loop_detection                 JSONB NOT NULL DEFAULT '{}',
  subagents                      JSONB NOT NULL DEFAULT '{}',
  sandbox                        JSONB NOT NULL DEFAULT '{}',
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO sys_tools_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================================
-- 15. Migration tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS _migrations (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL UNIQUE,
  applied_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Auto-update updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_api_keys_updated_at BEFORE UPDATE ON tenant_api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_agents_updated_at BEFORE UPDATE ON tenant_agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_channels_updated_at BEFORE UPDATE ON tenant_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_channel_apps_updated_at BEFORE UPDATE ON tenant_channel_apps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_tenant_models_updated_at BEFORE UPDATE ON tenant_models
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Platform overview indexes (cross-tenant aggregation)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_usage_recorded_at ON usage_records (recorded_at);
CREATE INDEX IF NOT EXISTS idx_usage_model_time ON usage_records (model, recorded_at);
CREATE INDEX IF NOT EXISTS idx_usage_agent_time ON usage_records (agent_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_traces_created_at ON llm_interaction_traces (created_at);
CREATE INDEX IF NOT EXISTS idx_traces_model_time ON llm_interaction_traces (model, created_at);

-- ============================================================
-- Seed: Platform admin tenant + user (password: Aa123456!)
-- ============================================================
INSERT INTO tenants (id, name, slug, plan, status, quotas)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'EnClaws Platform',
  '_platform',
  'enterprise',
  'active',
  '{"maxUsers":10,"maxAgents":0,"maxChannels":0,"maxTokensPerMonth":0}'
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO users (id, tenant_id, email, password_hash, display_name, role, status)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'admin@enclaws.local',
  '$2b$12$KIBNGrqC9DmrXbPeutbl5.IebhcHmsWEld9jeS3XvSQk07NV3EPB.',
  'Platform Admin',
  'platform-admin',
  'active'
)
ON CONFLICT DO NOTHING;
