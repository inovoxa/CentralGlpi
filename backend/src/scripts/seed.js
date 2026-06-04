// Define a senha inicial dos usuários que ainda não têm hash (senha_hash NULL).
// A senha vem de SEED_DEFAULT_PASSWORD; se vazia, gera uma aleatória e imprime.
// Todos entram com essa senha e, como primeiro_acesso=TRUE, cadastram o TOTP no 1º login.
// Uso: npm run seed
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { config } from '../config.js';
import { pgPool, pgClose } from '../db/postgres.js';

function strongRandom() {
  // 16 chars base64url legíveis
  return crypto.randomBytes(12).toString('base64url');
}

const senha = config.seedDefaultPassword || strongRandom();

try {
  const hash = await argon2.hash(senha, { type: argon2.argon2id });
  const r = await pgPool.query(
    `UPDATE glpi_n8n.app_usuarios
        SET senha_hash = $1
      WHERE senha_hash IS NULL
      RETURNING email`,
    [hash],
  );
  if (r.rowCount === 0) {
    console.log('Nenhum usuário sem senha — nada a fazer (use o painel para resetar senhas).');
  } else {
    console.log(`Senha inicial definida para ${r.rowCount} usuário(s):`);
    r.rows.forEach((u) => console.log('  -', u.email));
    console.log('\n  Senha inicial:', senha);
    console.log('  (cada usuário cadastra o Google Authenticator no primeiro login)');
  }
} catch (err) {
  console.error('FALHOU:', err.message);
  process.exitCode = 1;
} finally {
  await pgClose();
}
