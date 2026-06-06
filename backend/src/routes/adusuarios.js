// GET /api/usuarios-logon — usuários do AD + último logon (para a Visão Geral).
import { listarUsuariosLogon } from '../ad/usuarios.js';
import { adEnabled } from '../ad/ssh.js';

export default async function adUsuariosRoutes(fastify) {
  fastify.get('/api/usuarios-logon', { preHandler: fastify.requirePerm('view_audit') }, async (req, reply) => {
    if (!adEnabled()) return { configured: false, usuarios: [] };
    try {
      const usuarios = await listarUsuariosLogon();
      return { configured: true, usuarios };
    } catch (e) {
      return reply.code(502).send({ error: 'falha ao consultar usuários no AD', detail: e.message });
    }
  });
}
