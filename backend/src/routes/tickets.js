// Chamados e Kanban: lista (GLPI + chamados_log) e write-back de status (API v1).
import {
  listTickets, ticketIdsBySector, enrichFromLog,
  ticketDetail, ticketFollowups, ticketTasks, ticketSolution, ticketDocuments,
} from '../db/ticketQueries.js';
import { updateTicketStatus } from '../glpi/v1.js';
import { logOperation } from '../db/audit.js';
import {
  statusToColumn, columnToStatus, isBreached, priorityLabel, slaPercent, sectorSigla, relTime,
} from '../lib/ticketMap.js';

const STLABEL = {
  aberto: 'Aberto', aguardando_aprovacao: 'Aguardando aprovação',
  em_execucao: 'Em execução', resolvido: 'Resolvido', violou_sla: 'Violou SLA',
};
const pad = (n) => String(n).padStart(2, '0');
function fmtFull(d) {
  const x = new Date(d);
  return `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
// Remove HTML do conteúdo do GLPI (descrição/followups vêm com markup).
function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
}
const NIVEL = { 1: 'Muito baixa', 2: 'Baixa', 3: 'Média', 4: 'Alta', 5: 'Muito alta', 6: 'Crítica' };
const nivel = (n) => NIVEL[Number(n)] || '—';
const arr = (v) => (Array.isArray(v) ? v : []);

// Escopo de setor conforme RBAC: view_all => filtro opcional; view_sector => travado no próprio setor.
function sectorScope(session, query, can) {
  if (can(session.profile, 'view_all')) {
    return { sector: query.sector && query.sector !== 'all' ? String(query.sector) : null, ok: true };
  }
  if (can(session.profile, 'view_sector')) {
    return { sector: session.sector || '__none__', ok: true };
  }
  return { ok: false };
}

function shape(row, enrich) {
  const log = enrich[row.id] || {};
  const sector = log.secretaria || null;
  const breached = isBreached({ glpiStatus: row.glpiStatus, ttr: row.ttr, solvedate: row.solvedate });
  const status = breached ? 'violou_sla' : statusToColumn(row.glpiStatus);
  const iso = row.date ? new Date(row.date).toISOString() : null;
  return {
    id: row.id,
    sol: row.solicitante || '—',
    sector: sector || '—',
    sigla: sectorSigla(sector),
    cat: row.categoria || 'Sem categoria',
    canal: log.canal || 'Manual',
    status,
    statusLabel: STLABEL[status],
    sla: slaPercent({ date: row.date, ttr: row.ttr, solvedate: row.solvedate }),
    assignee: row.assignee || '—',
    prio: priorityLabel(row.priority),
    entidade: row.entidade || '—',
    local: row.local || '—',
    grupoTecnico: row.grupo_tecnico || '—',
    abertoIso: iso,
    abertoRel: relTime(iso),
    abertoFull: row.date ? fmtFull(row.date) : '',
  };
}

export default async function ticketRoutes(fastify) {
  const { can } = await import('../lib/rbac.js');

  // GET /api/tickets — lista para Chamados e Kanban.
  fastify.get('/api/tickets', { preHandler: fastify.authenticate }, async (req, reply) => {
    const scope = sectorScope(req.session, req.query, can);
    if (!scope.ok) return reply.code(403).send({ error: 'permissão negada' });

    let ids = null;
    if (scope.sector) {
      ids = scope.sector === '__none__' ? [] : await ticketIdsBySector(scope.sector);
    }
    const search = (req.query.search || '').toString().trim().slice(0, 80);
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 300);
    const DIAS = { '7d': 7, '30d': 30, '90d': 90, '180d': 180 };
    const dias = DIAS[req.query.period] || 30;
    const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 19).replace('T', ' ');

    const { rows, total } = await listTickets({ ids, search, limit, desde });
    const enrich = await enrichFromLog(rows.map((r) => r.id));
    return { tickets: rows.map((r) => shape(r, enrich)), total, sector: scope.sector === '__none__' ? null : scope.sector };
  });

  // GET /api/tickets/:id — detalhe rico + linha do tempo real (GLPI MySQL).
  fastify.get('/api/tickets/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return reply.code(400).send({ error: 'id inválido' });
    const safe = (p) => p.then((v) => v).catch(() => null);

    let d;
    try { d = await ticketDetail(id); } catch (e) {
      return reply.code(502).send({ error: 'falha ao ler o chamado no GLPI', detail: e.message });
    }
    if (!d) return reply.code(404).send({ error: 'chamado não encontrado' });

    const [fups, tasks, sols, docs, enrich] = await Promise.all([
      safe(ticketFollowups(id)), safe(ticketTasks(id)), safe(ticketSolution(id)), safe(ticketDocuments(id)), enrichFromLog([id]).catch(() => ({})),
    ]);
    const log = enrich[id] || {};
    const iso = (x) => (x ? new Date(x).toISOString() : null);

    const tl = [];
    if (d.date) tl.push({ tipo: 'abertura', when: iso(d.date), autor: d.solicitante || null, texto: 'Chamado aberto' });
    for (const f of arr(fups)) tl.push({ tipo: 'followup', when: iso(f.date), autor: f.autor || null, texto: stripHtml(f.content) });
    for (const t of arr(tasks)) tl.push({ tipo: 'tarefa', when: iso(t.date), autor: t.autor || null, texto: stripHtml(t.content) });
    for (const s of arr(sols)) tl.push({ tipo: 'solucao', when: iso(s.date), autor: null, texto: stripHtml(s.content) });
    if (d.solvedate) tl.push({ tipo: 'resolvido', when: iso(d.solvedate), texto: 'Chamado solucionado' });
    if (d.closedate) tl.push({ tipo: 'fechado', when: iso(d.closedate), texto: 'Chamado fechado' });
    tl.sort((a, b) => ((a.when || '') < (b.when || '') ? -1 : (a.when || '') > (b.when || '') ? 1 : 0));

    const breached = isBreached({ glpiStatus: d.glpiStatus, ttr: d.ttr, solvedate: d.solvedate });
    const status = breached ? 'violou_sla' : statusToColumn(d.glpiStatus);

    return {
      ticket: {
        id: d.id,
        titulo: d.titulo,
        descricao: stripHtml(d.content),
        sol: d.solicitante || '—',
        assignee: d.assignee || '—',
        sector: log.secretaria || '—',
        canal: log.canal || 'Manual',
        cat: d.categoria || 'Sem categoria',
        status,
        statusLabel: STLABEL[status],
        prio: priorityLabel(d.priority),
        urgencia: nivel(d.urgency),
        impacto: nivel(d.impact),
        entidade: d.entidade || '—',
        local: d.local || '—',
        grupoTecnico: d.grupo_tecnico || '—',
        sla: slaPercent({ date: d.date, ttr: d.ttr, solvedate: d.solvedate }),
        abertoFull: d.date ? fmtFull(d.date) : '—',
      },
      anexos: arr(docs).map((x) => ({ nome: x.name || x.filename, arquivo: x.filename, mime: x.mime || '' })),
      timeline: tl,
    };
  });

  // PATCH /api/tickets/:id/status — move card no Kanban -> grava status no GLPI (API v1).
  fastify.patch('/api/tickets/:id/status', { preHandler: fastify.requirePerm('move_kanban') }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const col = (req.body && req.body.status) || '';
    if (!id) return reply.code(400).send({ error: 'id inválido' });
    const glpiStatus = columnToStatus(col);
    if (!glpiStatus) return reply.code(400).send({ error: 'coluna não gravável (ex.: "Violou SLA" é derivada)' });

    try {
      await updateTicketStatus(id, glpiStatus);
    } catch (err) {
      req.log.error({ err: err.message }, 'falha ao gravar status no GLPI');
      return reply.code(502).send({ error: 'não foi possível atualizar o chamado no GLPI', detail: err.message });
    }
    await logOperation({
      userId: req.session.uid, profile: req.session.profile,
      acao: `alterou status do chamado #${id}`, delta: `→ ${STLABEL[col] || col}`, ip: req.ip,
    });
    return { ok: true, id, status: col };
  });
}
