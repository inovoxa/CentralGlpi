// Personalização (white-label). GET é público (tela de login precisa antes de autenticar).
import { getBranding, saveBranding } from '../db/brandingQueries.js';
import { logOperation } from '../db/audit.js';

const VAZIO = { orgNome: '', cor: '', logo: '', favicon: '', banner: '', loginImg: '' };
const MAX = 2_200_000; // ~2MB por imagem (data URI base64)
const imgOk = (s) => !s || (typeof s === 'string'
  && /^data:image\/(png|jpe?g|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,/.test(s)
  && s.length <= MAX);

export default async function brandingRoutes(fastify) {
  // Público: usado também na tela de login.
  fastify.get('/api/branding', async () => {
    try { return await getBranding(); } catch { return VAZIO; }
  });

  fastify.patch('/api/admin/branding', {
    bodyLimit: 12 * 1024 * 1024,
    preHandler: fastify.requirePerm('manage_branding'),
  }, async (req, reply) => {
    const b = req.body || {};
    for (const f of ['logo', 'favicon', 'banner', 'loginImg']) {
      if (!imgOk(b[f] || '')) return reply.code(400).send({ error: `imagem inválida ou grande demais em "${f}" (máx ~2MB, precisa ser data URI de imagem)` });
    }
    await saveBranding({
      orgNome: String(b.orgNome || '').slice(0, 120),
      cor: String(b.cor || '').slice(0, 32),
      logo: b.logo || '', favicon: b.favicon || '', banner: b.banner || '', loginImg: b.loginImg || '',
    });
    await logOperation({ userId: req.session.uid, profile: req.session.profile, acao: 'atualizou a personalização (white-label)', delta: '', ip: req.ip });
    return { ok: true };
  });
}
