// GET /api/me — usuário atual + catálogo de RBAC. Também: troca de senha e acessos próprios.
import argon2 from 'argon2';
import { findById, setOwnPassword } from '../db/users.js';
import { acessoDoUsuario } from '../db/adminQueries.js';
import { publicUser } from '../lib/dto.js';
import { rbacCatalog } from '../lib/rbac.js';

export default async function meRoutes(fastify) {
  fastify.get('/api/me', { preHandler: fastify.authenticate }, async (req, reply) => {
    const user = await findById(req.session.uid);
    if (!user) {
      reply.clearSession();
      return reply.code(401).send({ error: 'sessão expirada' });
    }
    return { user: publicUser(user), rbac: rbacCatalog() };
  });

  // Acessos recentes do próprio usuário (tela Meu perfil).
  fastify.get('/api/me/acessos', { preHandler: fastify.authenticate }, async (req) =>
    ({ acessos: await acessoDoUsuario(req.session.uid, 10) }));

  // Troca da própria senha (confirma a senha atual).
  fastify.post('/api/me/senha', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { atual, nova } = req.body || {};
    if (!atual || !nova) return reply.code(400).send({ error: 'informe a senha atual e a nova' });
    if (String(nova).length < 12) return reply.code(400).send({ error: 'a nova senha deve ter ao menos 12 caracteres' });
    const user = await findById(req.session.uid);
    const ok = user?.senha_hash ? await argon2.verify(user.senha_hash, atual).catch(() => false) : false;
    if (!ok) return reply.code(401).send({ error: 'senha atual incorreta' });
    await setOwnPassword(user.id, await argon2.hash(nova, { type: argon2.argon2id }));
    return { ok: true };
  });
}
