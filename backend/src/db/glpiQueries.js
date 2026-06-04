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
