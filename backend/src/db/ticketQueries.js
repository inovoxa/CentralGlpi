// Consultas de tickets: GLPI (MySQL, fonte de status/datas/categoria/pessoas)
// enriquecidas com chamados_log (PostgreSQL, para canal e setor).
import { glpiQuery } from './mysql.js';
import { pgQuery } from './postgres.js';

// IDs de tickets de um setor (secretaria), a partir do chamados_log.
export async function ticketIdsBySector(sector) {
  const r = await pgQuery(
    `SELECT glpi_ticket_id FROM glpi_n8n.chamados_log
      WHERE glpi_ticket_id IS NOT NULL AND secretaria ILIKE $1`,
    ['%' + sector + '%'],
  );
  return r.rows.map((x) => Number(x.glpi_ticket_id)).filter(Boolean);
}

// Enriquecimento por lote: { ticketId: { secretaria, canal } } a partir do chamados_log.
export async function enrichFromLog(ids) {
  if (!ids.length) return {};
  const r = await pgQuery(
    `SELECT glpi_ticket_id, secretaria, conversa_id
       FROM glpi_n8n.chamados_log
      WHERE glpi_ticket_id = ANY($1::bigint[])`,
    [ids],
  );
  const map = {};
  for (const row of r.rows) {
    map[Number(row.glpi_ticket_id)] = {
      secretaria: row.secretaria || null,
      canal: row.conversa_id ? 'WhatsApp' : 'Formulário', // veio do pipeline de automação
    };
  }
  return map;
}

const SUB_REQUESTER = `(
  SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', us.firstname, us.realname)), ''), us.name)
    FROM glpi_tickets_users tu JOIN glpi_users us ON us.id = tu.users_id
   WHERE tu.tickets_id = t.id AND tu.type = 1 ORDER BY tu.id LIMIT 1)`;
const SUB_ASSIGNEE = `(
  SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ua.firstname, ua.realname)), ''), ua.name)
    FROM glpi_tickets_users tu2 JOIN glpi_users ua ON ua.id = tu2.users_id
   WHERE tu2.tickets_id = t.id AND tu2.type = 2 ORDER BY tu2.id LIMIT 1)`;

// Lista de tickets do GLPI. opts: { ids?, search?, limit, offset }.
// Retorna { rows, total }. Se ids for [] (setor sem tickets), retorna vazio.
export async function listTickets({ ids = null, search = '', limit = 200, offset = 0 } = {}) {
  if (ids && ids.length === 0) return { rows: [], total: 0 };

  const where = ['t.is_deleted = 0'];
  const params = {};
  if (ids && ids.length) {
    const keys = ids.map((v, i) => { params['id' + i] = v; return ':id' + i; });
    where.push(`t.id IN (${keys.join(',')})`);
  }
  if (search) {
    params.q = '%' + search + '%';
    params.qid = /^\d+$/.test(search) ? Number(search) : -1;
    where.push('(t.name LIKE :q OR t.id = :qid)');
  }
  const whereSql = where.join(' AND ');
  params.lim = Math.min(500, Math.max(1, limit));
  params.off = Math.max(0, offset);

  const rows = await glpiQuery(
    `SELECT t.id, t.name AS titulo, t.date AS date, t.status AS glpiStatus,
            t.priority AS priority, t.time_to_resolve AS ttr, t.solvedate AS solvedate,
            c.completename AS categoria,
            ${SUB_REQUESTER} AS solicitante,
            ${SUB_ASSIGNEE}  AS assignee
       FROM glpi_tickets t
       LEFT JOIN glpi_itilcategories c ON c.id = t.itilcategories_id
      WHERE ${whereSql}
      ORDER BY t.date DESC
      LIMIT :lim OFFSET :off`,
    params,
  );
  const countRows = await glpiQuery(
    `SELECT COUNT(*) AS c FROM glpi_tickets t WHERE ${whereSql}`,
    params,
  );
  return { rows, total: Number(countRows[0]?.c || 0) };
}

// Detalhe completo de um ticket (GLPI MySQL).
export async function ticketDetail(id) {
  const rows = await glpiQuery(
    `SELECT t.id, t.name AS titulo, t.content, t.date, t.status AS glpiStatus,
            t.priority, t.urgency, t.impact, t.type AS tipo,
            t.time_to_resolve AS ttr, t.solvedate, t.closedate,
            c.completename AS categoria,
            ${SUB_REQUESTER} AS solicitante,
            ${SUB_ASSIGNEE}  AS assignee
       FROM glpi_tickets t
       LEFT JOIN glpi_itilcategories c ON c.id = t.itilcategories_id
      WHERE t.id = :id AND t.is_deleted = 0
      LIMIT 1`,
    { id },
  );
  return rows[0] || null;
}

// Acompanhamentos (followups) do ticket.
export async function ticketFollowups(id) {
  return glpiQuery(
    `SELECT f.date, f.content,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.firstname, u.realname)), ''), u.name) AS autor
       FROM glpi_itilfollowups f
       LEFT JOIN glpi_users u ON u.id = f.users_id
      WHERE f.itemtype = 'Ticket' AND f.items_id = :id
      ORDER BY f.date`,
    { id },
  );
}

// Tarefas do ticket.
export async function ticketTasks(id) {
  return glpiQuery(
    `SELECT tt.date, tt.content, tt.state,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.firstname, u.realname)), ''), u.name) AS autor
       FROM glpi_tickettasks tt
       LEFT JOIN glpi_users u ON u.id = tt.users_id
      WHERE tt.tickets_id = :id
      ORDER BY tt.date`,
    { id },
  );
}

// Solução(ões) do ticket.
export async function ticketSolution(id) {
  return glpiQuery(
    `SELECT s.date, s.content
       FROM glpi_itilsolutions s
      WHERE s.itemtype = 'Ticket' AND s.items_id = :id
      ORDER BY s.date`,
    { id },
  );
}
