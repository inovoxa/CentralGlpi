// Ponto de entrada do backend da Central de Operações GLPI.
import Fastify from 'fastify';
import fstatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { config, validateConfig } from './config.js';
import authPlugin from './plugins/auth.js';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import overviewRoutes from './routes/overview.js';
import ticketRoutes from './routes/tickets.js';
import slaRoutes from './routes/sla.js';
import liveRoutes from './routes/live.js';
import conversasRoutes from './routes/conversas.js';
import agenteRoutes from './routes/agente.js';
import auditoriaRoutes from './routes/auditoria.js';
import adminRoutes from './routes/admin.js';
import { startCollector } from './ad/collector.js';
import { pgClose } from './db/postgres.js';
import { glpiClose } from './db/mysql.js';

const app = Fastify({
  logger: { level: config.isProd ? 'info' : 'debug' },
  trustProxy: true, // atrás do proxy do Coolify: req.ip = IP real do cliente
});

validateConfig(app.log);

// Aceita corpo JSON vazio em POST/DELETE sem payload (evita FST_ERR_CTP_EMPTY_JSON_BODY).
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  if (!body || !body.trim()) return done(null, {});
  try { done(null, JSON.parse(body)); } catch (err) { err.statusCode = 400; done(err); }
});

// Limite de requisições (defesa básica; o lockout por usuário fica no banco).
await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

// Autenticação (cookie + JWT + decorators) antes das rotas que dependem dela.
await app.register(authPlugin);

// API
await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(meRoutes);
await app.register(overviewRoutes);
await app.register(ticketRoutes);
await app.register(slaRoutes);
await app.register(liveRoutes);
await app.register(conversasRoutes);
await app.register(agenteRoutes);
await app.register(auditoriaRoutes);
await app.register(adminRoutes);

// Front estático (index.html + imagens). Wildcard não conflita com /api/* (rotas exatas vencem).
await app.register(fstatic, {
  root: config.staticDir,
  prefix: '/',
  index: 'index.html',
});

// Encerramento gracioso
async function shutdown(signal) {
  app.log.info(`recebido ${signal}, encerrando...`);
  await app.close().catch(() => {});
  await Promise.all([pgClose(), glpiClose()]);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Central GLPI backend em http://${config.host}:${config.port} (estático: ${config.staticDir})`);
  startCollector(app.log); // coletor de auditoria de AD (só roda se AD_SSH_HOST estiver definido)
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
