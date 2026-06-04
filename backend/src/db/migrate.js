// Aplica as migrações .sql (em ordem) no PostgreSQL. Reutilizado pelo script
// `npm run migrate` e, opcionalmente, no boot do servidor (RUN_MIGRATIONS_ON_START).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgPool } from './postgres.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function runMigrations(log) {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    await pgPool.query(sql);
    log?.info?.(`[migrate] ${f} aplicada`);
  }
  return files.length;
}
