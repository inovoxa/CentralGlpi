// Consultas de administração (usuários do painel, logs de auditoria, setores).
import { pgQuery } from './postgres.js';

// ---- Usuários do sistema ----
export const listUsuarios = async () => (await pgQuery(
  `SELECT id, nome, email, profile, sector, status, totp_enabled, primeiro_acesso, ultimo_login, tel
     FROM glpi_n8n.app_usuarios ORDER BY nome`)).rows;

export const countPorPerfil = async () => (await pgQuery(
  `SELECT profile, COUNT(*)::int AS total FROM glpi_n8n.app_usuarios GROUP BY profile`)).rows;

export async function createUsuario({ nome, email, profile, sector, senhaHash }) {
  const r = await pgQuery(
    `INSERT INTO glpi_n8n.app_usuarios (nome, email, profile, sector, senha_hash, primeiro_acesso)
     VALUES ($1,$2,$3,$4,$5, TRUE) RETURNING id`,
    [nome, email, profile, sector || null, senhaHash || null]);
  return r.rows[0].id;
}

export async function updateUsuario(id, { profile, sector, status }) {
  await pgQuery(
    `UPDATE glpi_n8n.app_usuarios
        SET profile = COALESCE($2, profile),
            sector  = COALESCE($3, sector),
            status  = COALESCE($4, status)
      WHERE id = $1`,
    [id, profile || null, sector ?? null, status || null]);
}

export async function setSenha(id, hash) {
  await pgQuery(
    `UPDATE glpi_n8n.app_usuarios SET senha_hash = $2, primeiro_acesso = TRUE, failed_attempts = 0, locked_until = NULL WHERE id = $1`,
    [id, hash]);
}

export async function resetTotp(id) {
  await pgQuery(`UPDATE glpi_n8n.app_usuarios SET totp_enabled = FALSE, totp_secret = NULL WHERE id = $1`, [id]);
}

export async function removeUsuario(id) {
  await pgQuery('DELETE FROM glpi_n8n.app_usuarios WHERE id = $1', [id]);
}

// ---- Logs ----
export const listAcesso = async (limit = 200) => (await pgQuery(
  `SELECT a.created_at, a.email, COALESCE(u.nome, a.email) AS nome, a.action, a.result, a.ip, a.user_agent
     FROM glpi_n8n.app_audit_acesso a
     LEFT JOIN glpi_n8n.app_usuarios u ON u.id = a.user_id
    ORDER BY a.created_at DESC LIMIT $1`, [limit])).rows;

export const listOperacao = async (limit = 200) => (await pgQuery(
  `SELECT o.created_at, COALESCE(u.nome, '—') AS nome, o.profile, o.acao, o.delta, o.ip
     FROM glpi_n8n.app_audit_operacao o
     LEFT JOIN glpi_n8n.app_usuarios u ON u.id = o.user_id
    ORDER BY o.created_at DESC LIMIT $1`, [limit])).rows;

export const acessoDoUsuario = async (userId, limit = 10) => (await pgQuery(
  `SELECT created_at, action, result, ip, user_agent FROM glpi_n8n.app_audit_acesso
    WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit])).rows;

// ---- Setores em uso (a partir do chamados_log) ----
export const setoresEmUso = async () => (await pgQuery(
  `SELECT secretaria AS nome, COUNT(*)::int AS chamados,
          COUNT(*) FILTER (WHERE ad_executado)::int AS automatizados,
          MAX(created_at) AS ultimo
     FROM glpi_n8n.chamados_log
    WHERE secretaria IS NOT NULL AND secretaria <> ''
    GROUP BY secretaria ORDER BY chamados DESC`)).rows;
