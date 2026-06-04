// Rotas de Auditoria de AD: resumo para a Visão Geral, perfil do usuário e busca global.
import {
  logonsHoje, quemLogouHoje, ultimosLogons, logonsSimultaneos,
  bloqueiosRecentes, bloqueiosTotal7d, falhas24h, bruteForce,
  perfilLocal, buscaUsuario, buscaMaquina,
} from '../db/auditQueries.js';
import { userLookup } from '../ad/collector.js';
import { adEnabled } from '../ad/ssh.js';

async function safe(p, fb) { try { return await p; } catch { return fb; } }
const SAFE_LOGIN = /^[A-Za-z0-9._\-\\ ]{1,128}$/;

export default async function auditoriaRoutes(fastify) {
  // Resumo para os blocos acrescentados na Visão Geral (qualquer usuário autenticado).
  fastify.get('/api/auditoria/overview', { preHandler: fastify.authenticate }, async () => {
    const [
      logHoje, quemHoje, ultimos, simultaneos, bloqRec, bloqTot, fal24, brute,
    ] = await Promise.all([
      safe(logonsHoje(), 0), safe(quemLogouHoje(), []), safe(ultimosLogons(), []),
      safe(logonsSimultaneos(), []), safe(bloqueiosRecentes(), []), safe(bloqueiosTotal7d(), 0),
      safe(falhas24h(), 0), safe(bruteForce(), []),
    ]);
    return {
      configured: adEnabled(),
      logons: { hoje: logHoje, quemLogouHoje: quemHoje, ultimos, simultaneos },
      bloqueios: { recentes: bloqRec, total7d: bloqTot },
      eventosCriticos: { falhas24h: fal24, bruteForce: brute },
      generatedAt: new Date().toISOString(),
    };
  });

  // Perfil do usuário (dados sensíveis) — exige permissão de auditoria.
  fastify.get('/api/auditoria/usuario/:login', { preHandler: fastify.requirePerm('view_audit') }, async (req, reply) => {
    const login = String(req.params.login || '');
    if (!SAFE_LOGIN.test(login)) return reply.code(400).send({ error: 'login inválido' });
    const local = await safe(perfilLocal(login), null);
    let ad = null;
    let adErro = null;
    if (adEnabled()) {
      try { ad = await userLookup(login); } catch (e) { adErro = e.message; }
    }
    return { login, local, ad, adErro };
  });

  // Busca global por usuário ou máquina — exige permissão de auditoria.
  fastify.get('/api/auditoria/busca', { preHandler: fastify.requirePerm('view_audit') }, async (req) => {
    const q = String(req.query.q || '').trim();
    const tipo = req.query.tipo === 'maquina' ? 'maquina' : 'usuario';
    if (q.length < 2) return { tipo, q, resultados: [] };
    const resultados = tipo === 'maquina' ? await safe(buscaMaquina(q), []) : await safe(buscaUsuario(q), []);
    return { tipo, q, resultados };
  });
}
