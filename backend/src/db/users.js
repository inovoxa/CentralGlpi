// Repositório de usuários do painel (tabela app_usuarios no schema da aplicação).
// Todas as queries são parametrizadas. O search_path do pool já inclui o schema.
import { pgQuery } from './postgres.js';

const COLS = `id, nome, email, senha_hash, profile, sector, status,
              totp_secret, totp_enabled, primeiro_acesso,
              failed_attempts, locked_until, ultimo_login, tel`;

export async function findByEmail(email) {
  const r = await pgQuery(
    `SELECT ${COLS} FROM app_usuarios WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  return r.rows[0] || null;
}

export async function findById(id) {
  const r = await pgQuery(`SELECT ${COLS} FROM app_usuarios WHERE id = $1 LIMIT 1`, [id]);
  return r.rows[0] || null;
}

export async function recordFailedLogin(id, maxAttempts, lockoutMinutes) {
  const r = await pgQuery(
    `UPDATE app_usuarios
        SET failed_attempts = failed_attempts + 1,
            locked_until = CASE
              WHEN failed_attempts + 1 >= $2
              THEN NOW() + ($3 || ' minutes')::interval
              ELSE locked_until
            END
      WHERE id = $1
      RETURNING failed_attempts, locked_until`,
    [id, maxAttempts, String(lockoutMinutes)],
  );
  return r.rows[0];
}

export async function resetFailedLogin(id) {
  await pgQuery(
    `UPDATE app_usuarios SET failed_attempts = 0, locked_until = NULL WHERE id = $1`,
    [id],
  );
}

export async function setTotpSecret(id, encSecret) {
  await pgQuery(`UPDATE app_usuarios SET totp_secret = $2 WHERE id = $1`, [id, encSecret]);
}

export async function enableTotp(id) {
  await pgQuery(
    `UPDATE app_usuarios SET totp_enabled = TRUE, primeiro_acesso = FALSE WHERE id = $1`,
    [id],
  );
}

export async function touchLogin(id) {
  await pgQuery(`UPDATE app_usuarios SET ultimo_login = NOW() WHERE id = $1`, [id]);
}

// Troca de senha pelo próprio usuário (não força primeiro acesso).
export async function setOwnPassword(id, hash) {
  await pgQuery(`UPDATE app_usuarios SET senha_hash = $2 WHERE id = $1`, [id, hash]);
}
