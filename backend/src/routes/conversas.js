// Histórico de conversas (Chatwoot), enriquecido com chamados_log (ticket/setor).
import {
  chatwootReady, listConversations, getMessages, sendMessage,
  findAgentByEmail, assignConversation,
} from '../chatwoot/client.js';
import { convLinks } from '../db/convQueries.js';
import { sectorSigla, relTime } from '../lib/ticketMap.js';
import { logOperation } from '../db/audit.js';

const pad = (n) => String(n).padStart(2, '0');
// Chatwoot envia created_at em epoch (segundos). Formata HH:MM.
function hhmm(epoch) {
  if (!epoch) return '';
  const d = new Date(epoch * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function isoFrom(epoch) { return epoch ? new Date(epoch * 1000).toISOString() : null; }

// Mensagem do Chatwoot -> bolha do painel.
function mapMessage(m) {
  const type = Number(m.message_type); // 0 incoming, 1 outgoing, 2 activity
  if (type === 2) return { from: 'sys', text: m.content || '', time: hhmm(m.created_at), color: 'grey' };
  const senderType = (m.sender_type || m.sender?.type || '').toLowerCase();
  let from = 'user';
  let name;
  if (type === 1) {
    if (senderType.includes('bot')) from = 'ai';
    else { from = 'tec'; name = m.sender?.name || 'Atendente'; }
  }
  const audioAtt = (m.attachments || []).find((a) => (a.file_type || '').toLowerCase() === 'audio');
  const out = { from, text: m.content || '', time: hhmm(m.created_at) };
  if (name) out.name = name;
  if (audioAtt) out.audio = { dur: '', transcript: m.content || '', url: audioAtt.data_url || '' };
  return out;
}

// Conversa do Chatwoot -> item da lista do painel.
function mapConversation(c, links) {
  const id = c.id;
  const link = links[id] || {};
  const nome = c.meta?.sender?.name || c.contact?.name || `Conversa #${id}`;
  const last = Array.isArray(c.messages) && c.messages.length ? c.messages[c.messages.length - 1] : null;
  const lastAudio = (c.messages || []).some((m) => (m.attachments || []).some((a) => (a.file_type || '').toLowerCase() === 'audio'));
  const preview = last ? (last.attachments?.length ? '🎤 Áudio' : (last.content || '').split('\n')[0].slice(0, 46)) : '';
  const sector = link.secretaria || '—';
  return {
    id,
    nome,
    sector,
    sigla: sectorSigla(link.secretaria),
    canal: 'WhatsApp',
    rel: relTime(isoFrom(c.last_activity_at)) || '',
    ticket: link.ticket || null,
    humano: !!c.meta?.assignee,
    audio: lastAudio,
    preview,
  };
}

export default async function conversasRoutes(fastify) {
  const { can } = await import('../lib/rbac.js');

  // GET /api/conversas — lista (filtra por setor para gestor).
  fastify.get('/api/conversas', { preHandler: fastify.authenticate }, async (req) => {
    if (!(await chatwootReady())) return { conversas: [], configured: false };
    let convs = [];
    try { convs = await listConversations({ status: req.query.status || 'open' }); } catch (e) { req.log.error(e.message); }

    const links = await convLinks(convs.map((c) => c.id)).catch(() => ({}));
    let items = convs.map((c) => mapConversation(c, links));

    // Gestor (view_sector) vê só conversas do próprio setor.
    if (!can(req.session.profile, 'view_all') && can(req.session.profile, 'view_sector')) {
      const sec = (req.session.sector || '').toLowerCase();
      items = items.filter((c) => (c.sector || '').toLowerCase().includes(sec));
    }
    return { conversas: items, configured: true };
  });

  // GET /api/conversas/:id — mensagens da conversa.
  fastify.get('/api/conversas/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return reply.code(400).send({ error: 'id inválido' });
    try {
      const msgs = await getMessages(id);
      return { id, msgs: msgs.map(mapMessage) };
    } catch (e) {
      return reply.code(502).send({ error: 'não foi possível carregar a conversa', detail: e.message });
    }
  });

  // POST /api/conversas/:id/mensagens — responder (intervenção humana).
  fastify.post('/api/conversas/:id/mensagens', { preHandler: fastify.requirePerm('send_msg') }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const content = (req.body && req.body.content || '').toString().trim();
    if (!id || !content) return reply.code(400).send({ error: 'conversa e conteúdo são obrigatórios' });
    try {
      await sendMessage(id, content);
    } catch (e) {
      return reply.code(502).send({ error: 'falha ao enviar a mensagem', detail: e.message });
    }
    await logOperation({ userId: req.session.uid, profile: req.session.profile, acao: `respondeu a conversa #${id}`, ip: req.ip });
    return { ok: true };
  });

  // POST /api/conversas/:id/assumir — atribui a conversa ao agente correspondente (por e-mail).
  fastify.post('/api/conversas/:id/assumir', { preHandler: fastify.requirePerm('assume') }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return reply.code(400).send({ error: 'id inválido' });
    try {
      const agent = await findAgentByEmail(req.session.email);
      if (!agent) return reply.code(409).send({ error: 'seu usuário não está cadastrado como agente no Chatwoot' });
      await assignConversation(id, agent.id);
    } catch (e) {
      return reply.code(502).send({ error: 'falha ao assumir a conversa', detail: e.message });
    }
    await logOperation({ userId: req.session.uid, profile: req.session.profile, acao: `assumiu a conversa #${id}`, ip: req.ip });
    return { ok: true };
  });
}
