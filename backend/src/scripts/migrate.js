// Aplica as migrações .sql no PostgreSQL configurado. Uso: npm run migrate
import { runMigrations } from '../db/migrate.js';
import { pgClose } from '../db/postgres.js';

try {
  const n = await runMigrations(console);
  console.log(`\n${n} migração(ões) aplicada(s).`);
} catch (err) {
  console.error('FALHOU:', err.message);
  process.exitCode = 1;
} finally {
  await pgClose();
}
