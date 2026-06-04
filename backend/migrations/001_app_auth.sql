-- ================================================================
-- Migração 001 — Autenticação do painel (Central de Operações GLPI)
-- Idempotente. Schema glpi_n8n (mesmo dos workflows n8n / PG_SCHEMA).
-- Cria: app_usuarios, app_audit_acesso, app_audit_operacao + seed de usuários.
-- Senhas NÃO ficam aqui: rode `npm run seed` para definir o hash argon2.
-- ================================================================

CREATE SCHEMA IF NOT EXISTS glpi_n8n;

-- ---- Usuários do painel ----------------------------------------
CREATE TABLE IF NOT EXISTS glpi_n8n.app_usuarios (
  id              SERIAL PRIMARY KEY,
  nome            TEXT NOT NULL,
  email           TEXT NOT NULL,
  senha_hash      TEXT,                         -- argon2 (definido pelo seed)
  profile         TEXT NOT NULL DEFAULT 'tecnico',
  sector          TEXT,
  status          TEXT NOT NULL DEFAULT 'ativo',
  totp_secret     TEXT,                         -- AES-256-GCM (cifrado)
  totp_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  primeiro_acesso BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  ultimo_login    TIMESTAMPTZ,
  tel             TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_usuarios_email
  ON glpi_n8n.app_usuarios (lower(email));

-- ---- Log de acesso (login/logout/falhas do painel) -------------
CREATE TABLE IF NOT EXISTS glpi_n8n.app_audit_acesso (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER,
  email       TEXT,
  action      TEXT NOT NULL,                    -- login | logout | totp
  result      TEXT NOT NULL,                    -- sucesso | falha | bloqueado
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_app_audit_acesso_created ON glpi_n8n.app_audit_acesso (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_audit_acesso_user    ON glpi_n8n.app_audit_acesso (user_id);

-- ---- Log de operação (ações dentro do painel) ------------------
CREATE TABLE IF NOT EXISTS glpi_n8n.app_audit_operacao (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER,
  profile     TEXT,
  acao        TEXT NOT NULL,
  delta       TEXT,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_app_audit_operacao_created ON glpi_n8n.app_audit_operacao (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_audit_operacao_user    ON glpi_n8n.app_audit_operacao (user_id);

-- ---- Seed dos usuários (sem senha; defina via `npm run seed`) ---
-- Mesmos usuários/perfis que o protótipo trazia em memória.
INSERT INTO glpi_n8n.app_usuarios (nome, email, profile, sector, tel) VALUES
  ('Fabrício Muaca',  'fabricio@araraquara.sp.gov.br',       'admin',   'TI',            '(16) 99999-0001'),
  ('Administrador',   'admin@araraquara.sp.gov.br',          'admin',   'TI',            '(16) 99999-0002'),
  ('Lucas Teixeira',  'coordenador@araraquara.sp.gov.br',    'coord',   'TI',            '(16) 99999-0003'),
  ('Rafael Lima',     'tecnico@araraquara.sp.gov.br',        'tecnico', 'TI',            '(16) 99999-0004'),
  ('Mariana Pereira', 'gestor.saude@araraquara.sp.gov.br',   'gestor',  'Saúde',         '(16) 99999-0005'),
  ('Sandra Auditoria','auditor@araraquara.sp.gov.br',        'auditor', 'Administração', '(16) 99999-0006')
ON CONFLICT (lower(email)) DO NOTHING;
