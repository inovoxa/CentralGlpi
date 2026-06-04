// GET /api/me — usuário atual + catálogo de RBAC (para o front montar menus e can()).
import { findById } from '../db/users.js';
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
}
