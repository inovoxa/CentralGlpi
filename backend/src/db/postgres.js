// Pool PostgreSQL (schema glpi_n8n / public). Mesmo banco usado pelos workflows n8n.
// Usa sempre queries parametrizadas ($1, $2, ...) — nunca interpolar valores.
import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

const poolConfig = config.pg.connectionString
  ? { connectionString: config.pg.connectionString }
  : {
      host: config.pg.host,
      port: config.pg.port,
      user: config.pg.user,
      password: config.pg.password,
      database: config.pg.database,
    };

// search_path para o schema da aplicação + public (fallback das tabelas n8n).
poolConfig.options = `-c search_path=${config.pg.schema},public`;
poolConfig.max = 10;
poolConfig.idleTimeoutMillis = 30_000;
poolConfig.connectionTimeoutMillis = 4_000;

export const pgPool = new Pool(poolConfig);

// Evita derrubar o processo se o banco cair em runtime (Fastify segue de pé).
pgPool.on('error', (err) => {
  console.error('[pg] erro no pool ocioso:', err.message);
});

export function pgQuery(text, params) {
  return pgPool.query(text, params);
}

export async function pgHealth() {
  try {
    const r = await pgPool.query('SELECT 1 AS ok');
    return { up: true, detail: r.rows[0]?.ok === 1 ? 'ok' : 'inesperado' };
  } catch (err) {
    return { up: false, detail: err.message };
  }
}

export async function pgClose() {
  await pgPool.end().catch(() => {});
}
