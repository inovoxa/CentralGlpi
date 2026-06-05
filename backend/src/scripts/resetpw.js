// Redefine a senha de um usuário do painel e reseta o 2FA (re-cadastra no próximo login).
// Uso: npm run resetpw -- <email> <novaSenha>
import argon2 from 'argon2';
import { pgPool, pgClose } from '../db/postgres.js';

const email = process.argv[2] || process.env.EMAIL;
const senha = process.argv[3] || process.env.SENHA;

if (!email || !senha) {
  console.error('Uso: npm run resetpw -- <email> <novaSenha>');
  process.exit(1);
}

try {
  const hash = await argon2.hash(senha, { type: argon2.argon2id });
  const r = await pgPool.query(
    `UPDATE glpi_n8n.app_usuarios
        SET senha_hash = $1, totp_enabled = FALSE, totp_secret = NULL,
            failed_attempts = 0, locked_until = NULL, primeiro_acesso = FALSE
      WHERE lower(email) = lower($2)
      RETURNING email`,
    [hash, email],
  );
  if (r.rowCount) {
    console.log('OK — senha redefinida e 2FA resetado para:', r.rows[0].email);
    console.log('No próximo login, o usuário cadastra o autenticador novamente.');
  } else {
    console.log('Usuário não encontrado:', email);
  }
} catch (e) {
  console.error('FALHOU:', e.message);
  process.exitCode = 1;
} finally {
  await pgClose();
}
