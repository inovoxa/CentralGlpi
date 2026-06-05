// Consultas ao MySQL do GLPI (somente leitura) para a Visão Geral.
// Schema padrão do GLPI 10/11 (glpi_tickets, glpi_itilcategories).
// Datas no formato 'YYYY-MM-DD HH:MM:SS'.
import { glpiQuery } from './mysql.js';

// Total de tickets criados na janela [start, end).
export async function countTickets(start, end) {
  const rows = await glpiQuery(
    `SELECT COUNT(*) AS c
       FROM glpi_tickets
      WHERE is_deleted = 0 AND date >= :start AND date < :end`,
    { start, end },
  );
  return Number(rows[0]?.c || 0);
}

// % de SLA cumprido: entre os tickets resolvidos que tinham prazo (time_to_resolve)
// na janela, fração resolvida dentro do prazo. null se não há base (GLPI sem SLA).
export async function slaCompliance(start, end) {
  const rows = await glpiQuery(
    `SELECT
       SUM(time_to_resolve IS NOT NULL AND solvedate IS NOT NULL)                              AS com_prazo,
       SUM(time_to_resolve IS NOT NULL AND solvedate IS NOT NULL AND solvedate <= time_to_resolve) AS no_prazo
     FROM glpi_tickets
     WHERE is_deleted = 0 AND date >= :start AND date < :end`,
    { start, end },
  );
  const com = Number(rows[0]?.com_prazo || 0);
  const ok = Number(rows[0]?.no_prazo || 0);
  return com > 0 ? Math.round((ok / com) * 100) : null;
}

// Tempo médio de resolução (minutos) na janela [start, end).
export async function avgResolutionMin(start, end) {
  const rows = await glpiQuery(
    `SELECT AVG(TIMESTAMPDIFF(MINUTE, date, solvedate)) AS m
       FROM glpi_tickets
      WHERE is_deleted = 0 AND solvedate IS NOT NULL AND date >= :start AND date < :end`,
    { start, end },
  );
  return rows[0]?.m != null ? Math.round(Number(rows[0].m)) : null;
}

// Top técnicos por chamados resolvidos na janela.
export async function topTecnicos(start, end) {
  const rows = await glpiQuery(
    `SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.firstname, u.realname)), ''), u.name) AS nome,
            COUNT(*) AS total
       FROM glpi_tickets t
       JOIN glpi_tickets_users tu ON tu.tickets_id = t.id AND tu.type = 2
       JOIN glpi_users u ON u.id = tu.users_id
      WHERE t.is_deleted = 0 AND t.solvedate IS NOT NULL AND t.date >= :start AND t.date < :end
      GROUP BY nome ORDER BY total DESC LIMIT 6`,
    { start, end },
  );
  return rows.map((r) => ({ nome: r.nome, total: Number(r.total) }));
}

// Eventos recentes do GLPI (followups, tarefas, novos chamados) das últimas 24h.
export async function recentEventsGlpi() {
  const fups = await glpiQuery(
    `SELECT CONCAT('fup-', f.id) AS id, 'followup' AS tipo, f.date AS at, f.items_id AS ticket, f.content
       FROM glpi_itilfollowups f
      WHERE f.itemtype = 'Ticket' AND f.date >= (NOW() - INTERVAL 24 HOUR)
      ORDER BY f.date DESC LIMIT 15`,
  );
  const tasks = await glpiQuery(
    `SELECT CONCAT('task-', tt.id) AS id, 'tarefa' AS tipo, tt.date AS at, tt.tickets_id AS ticket, tt.content
       FROM glpi_tickettasks tt
      WHERE tt.date >= (NOW() - INTERVAL 24 HOUR)
      ORDER BY tt.date DESC LIMIT 15`,
  );
  const novos = await glpiQuery(
    `SELECT CONCAT('newt-', t.id) AS id, 'novo' AS tipo, t.date AS at, t.id AS ticket, t.name AS content
       FROM glpi_tickets t
      WHERE t.is_deleted = 0 AND t.date >= (NOW() - INTERVAL 24 HOUR)
      ORDER BY t.date DESC LIMIT 15`,
  );
  return [...fups, ...tasks, ...novos];
}

// Último ticket que estourou o SLA (resolvido após o prazo).
export async function lastSlaBreach() {
  const rows = await glpiQuery(
    `SELECT t.id AS id, c.completename AS categoria
       FROM glpi_tickets t
       LEFT JOIN glpi_itilcategories c ON c.id = t.itilcategories_id
      WHERE t.is_deleted = 0 AND t.time_to_resolve IS NOT NULL
        AND t.solvedate IS NOT NULL AND t.solvedate > t.time_to_resolve
      ORDER BY t.solvedate DESC
      LIMIT 1`,
  );
  const r = rows[0];
  return r ? { ticketId: r.id, categoria: r.categoria || null } : null;
}
