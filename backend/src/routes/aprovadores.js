// Aprovadores de chamado = membros do grupo do AD "Aprovadores GLPI".
// Leitura e escrita refletem direto no Active Directory. Gate: view_audit.
import { listAprovadores, addAprovador, removeAprovador } from '../ad/aprovadores.js';
import { adEnabled } from '../ad/ssh.js';
import { logOperation } from '../db/audit.js';

const SAFE_LOGIN = /^[A-Za-z0-9._\-\\ ]{1,128}$/;

export default async function aprovadoresRoutes(fastify) {
  fastify.get('/api/aprovadores', { preHandler: fastify.requirePerm('view_audit') }, async (req, reply) => {
    if (!adEnabled()) return { configured: false, grupo: 'Aprovadores GLPI', membros: [] };
    try {
      const d = await listAprovadores();
      return { configured: true, grupo: d.grupo, membros: d.membros || [] };
    } catch (e) {
      return reply.code(502).send({ error: 'falha ao consultar o AD', detail: e.message });
    }
  });

  fastify.post('/api/aprovadores', { preHandler: fastify.requirePerm('view_audit') }, async (req, reply) => {
    if (!adEnabled()) return reply.code(503).send({ error: 'AD não configurado' });
    const login = String((req.body && req.body.login) || '').trim();
    if (!SAFE_LOGIN.test(login)) return reply.code(400).send({ error: 'login inválido' });
    let d;
    try { d = await addAprovador(login); } catch (e) { return reply.code(502).send({ error: 'falha ao adicionar no AD', detail: e.message }); }
    await logOperation({ userId: req.session.uid, profile: req.session.profile, acao: 'adicionou aprovador no AD', delta: login, ip: req.ip });
    return { ok: true, grupo: d.grupo, membros: d.membros || [] };
  });

  fastify.delete('/api/aprovadores/:login', { preHandler: fastify.requirePerm('view_audit') }, async (req, reply) => {
    if (!adEnabled()) return reply.code(503).send({ error: 'AD não configurado' });
    const login = String(req.params.login || '').trim();
    if (!SAFE_LOGIN.test(login)) return reply.code(400).send({ error: 'login inválido' });
    let d;
    try { d = await removeAprovador(login); } catch (e) { return reply.code(502).send({ error: 'falha ao remover no AD', detail: e.message }); }
    await logOperation({ userId: req.session.uid, profile: req.session.profile, acao: 'removeu aprovador no AD', delta: login, ip: req.ip });
    return { ok: true, grupo: d.grupo, membros: d.membros || [] };
  });
}
