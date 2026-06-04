// GET /api/health — sempre 200 se o servidor está de pé; reporta cada dependência.
import { pgHealth } from '../db/postgres.js';
import { glpiHealth } from '../db/mysql.js';

export default async function healthRoutes(fastify) {
  fastify.get('/api/health', async () => {
    const [pg, glpi] = await Promise.all([pgHealth(), glpiHealth()]);
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      deps: { postgres: pg, glpi_mysql: glpi },
      time: new Date().toISOString(),
    };
  });
}
