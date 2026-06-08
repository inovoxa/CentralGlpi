-- Permissões por perfil editáveis (override dos defaults do rbac.js).
-- Tabela vazia => comportamento idêntico aos defaults. Linha presente => substitui.
CREATE TABLE IF NOT EXISTS glpi_n8n.app_perfil_perms (
  profile       text PRIMARY KEY,
  perms         jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
