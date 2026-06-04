// Chamados e Kanban: lista (GLPI + chamados_log) e write-back de status (API v1).
import { listTickets, ticketIdsBySector, enrichFromLog } from '../db/ticketQueries.js';
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

    const { rows, total } = await listTickets({ ids, search, limit });
    const enrich = await enrichFromLog(rows.map((r) => r.id));
    return { tickets: rows.map((r) => shape(r, enrich)), total, sector: scope.sector === '__none__' ? null : scope.sector };
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
