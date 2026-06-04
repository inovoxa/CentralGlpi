// Aplica as migrações .sql (em ordem) no PostgreSQL configurado.
// Uso: npm run migrate
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgPool, pgClose } from '../db/postgres.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
if (!files.length) {
  console.log('Nenhuma migração encontrada em', DIR);
  process.exit(0);
}

try {
  for (const f of files) {
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    process.stdout.write(`→ aplicando ${f} ... `);
    await pgPool.query(sql);
    console.log('ok');
  }
  console.log(`\n${files.length} migração(ões) aplicada(s).`);
} catch (err) {
  console.error('\nFALHOU:', err.message);
  process.exitCode = 1;
} finally {
  await pgClose();
}
