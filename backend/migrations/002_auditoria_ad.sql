-- ================================================================
-- Migração 002 — Auditoria de Active Directory (Central de Operações GLPI)
-- Idempotente. Tabelas alimentadas pelo coletor (SSH→PowerShell no DC).
-- Eventos do log de Segurança: 4624 logon, 4634 logoff, 4625 falha, 4740 lockout.
-- ================================================================

CREATE SCHEMA IF NOT EXISTS glpi_n8n;

-- Cursor de coleta incremental: último RecordId lido por evento.
CREATE TABLE IF NOT EXISTS glpi_n8n.auditoria_ad_cursor (
  event_id        INTEGER PRIMARY KEY,
  last_record_id  BIGINT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Logons (4624) e logoffs (4634).
CREATE TABLE IF NOT EXISTS glpi_n8n.auditoria_ad_logon (
  id           BIGSERIAL PRIMARY KEY,
  record_id    BIGINT,
  tipo         TEXT NOT NULL,           -- 'logon' | 'logoff'
  usuario      TEXT,
  computador   TEXT,
  ip           TEXT,
  logon_type   INTEGER,
  ocorrido_em  TIMESTAMPTZ,
  inserido_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (record_id, tipo)
);
CREATE INDEX IF NOT EXISTS idx_ad_logon_quando  ON glpi_n8n.auditoria_ad_logon (ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_ad_logon_usuario ON glpi_n8n.auditoria_ad_logon (lower(usuario));

-- Falhas de autenticação (4625) — base para brute force.
CREATE TABLE IF NOT EXISTS glpi_n8n.auditoria_ad_falha (
  id           BIGSERIAL PRIMARY KEY,
  record_id    BIGINT UNIQUE,
  usuario      TEXT,
  computador   TEXT,
  ip           TEXT,
  motivo       TEXT,
  ocorrido_em  TIMESTAMPTZ,
  inserido_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_falha_quando  ON glpi_n8n.auditoria_ad_falha (ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_ad_falha_usuario ON glpi_n8n.auditoria_ad_falha (lower(usuario));

-- Bloqueios de conta (4740).
CREATE TABLE IF NOT EXISTS glpi_n8n.auditoria_ad_bloqueio (
  id           BIGSERIAL PRIMARY KEY,
  record_id    BIGINT UNIQUE,
  usuario      TEXT,
  origem       TEXT,                    -- computador que causou o bloqueio
  ocorrido_em  TIMESTAMPTZ,
  inserido_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_bloqueio_quando  ON glpi_n8n.auditoria_ad_bloqueio (ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_ad_bloqueio_usuario ON glpi_n8n.auditoria_ad_bloqueio (lower(usuario));
