// Pool MySQL do GLPI — SOMENTE LEITURA. Use um usuário MySQL com apenas SELECT.
// Lazy: só cria o pool quando GLPI_DB_HOST está configurado, e nunca derruba o
// servidor se o GLPI estiver inacessível (as rotas tratam o erro).
import mysql from 'mysql2/promise';
import { config } from '../config.js';

let pool = null;

export function glpiEnabled() {
  return !!config.glpi.host;
}

export function getGlpiPool() {
  if (!glpiEnabled()) return null;
  if (!pool) {
    pool = mysql.createPool({
      host: config.glpi.host,
      port: config.glpi.port,
      user: config.glpi.user,
      password: config.glpi.password,
      database: config.glpi.database,
      waitForConnections: true,
      connectionLimit: 8,
      maxIdle: 4,
      idleTimeout: 30_000,
      connectTimeout: 8_000,
      namedPlaceholders: true,
    });
  }
  return pool;
}

// SELECT parametrizado. Lança se o GLPI não estiver configurado/acessível.
export async function glpiQuery(sql, params = {}) {
  const p = getGlpiPool();
  if (!p) throw new Error('GLPI MySQL não configurado (defina GLPI_DB_*).');
  const [rows] = await p.query(sql, params);
  return rows;
}

export async function glpiHealth() {
  if (!glpiEnabled()) return { up: false, detail: 'não configurado' };
  try {
    const rows = await glpiQuery('SELECT 1 AS ok');
    return { up: true, detail: rows[0]?.ok === 1 ? 'ok' : 'inesperado' };
  } catch (err) {
    return { up: false, detail: err.message };
  }
}

export async function glpiClose() {
  if (pool) await pool.end().catch(() => {});
}
