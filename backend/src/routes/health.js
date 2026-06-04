// GET /api/health — sempre 200 e RÁPIDO (timeout curto por dependência), para o
// healthcheck do orquestrador não estourar quando um banco está fora/instável.
import { pgHealth } from '../db/postgres.js';
import { glpiHealth } from '../db/mysql.js';

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export default async function healthRoutes(fastify) {
  fastify.get('/api/health', async () => {
    const [pg, glpi] = await Promise.all([
      withTimeout(pgHealth(), 2500, { up: false, detail: 'timeout' }),
      withTimeout(glpiHealth(), 2500, { up: false, detail: 'timeout' }),
    ]);
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      deps: { postgres: pg, glpi_mysql: glpi },
      time: new Date().toISOString(),
    };
  });
}
