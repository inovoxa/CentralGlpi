// Logs de auditoria do próprio painel (acesso e operação).
// Falhas de gravação não devem quebrar a requisição — apenas logam no console.
import { pgQuery } from './postgres.js';

export async function logAccess({ userId = null, email, action, result, ip, userAgent }) {
  try {
    await pgQuery(
      `INSERT INTO app_audit_acesso (user_id, email, action, result, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, email || null, action, result, ip || null, userAgent || null],
    );
  } catch (err) {
    console.error('[audit] falha ao registrar acesso:', err.message);
  }
}

export async function logOperation({ userId, profile, acao, delta = null, ip = null }) {
  try {
    await pgQuery(
      `INSERT INTO app_audit_operacao (user_id, profile, acao, delta, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, profile, acao, delta, ip],
    );
  } catch (err) {
    console.error('[audit] falha ao registrar operação:', err.message);
  }
}
