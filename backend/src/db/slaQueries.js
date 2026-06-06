// Séries para os gráficos da tela SLA & Métricas (MySQL GLPI). Janela: últimos ~6 meses.
import { glpiQuery } from './mysql.js';

const pct = (ok, com) => (com > 0 ? Math.round((ok / com) * 100) : null);

// Evolução diária do SLA na janela [start, end).
export async function slaTrend(start, end) {
  const rows = await glpiQuery(
    `SELECT DATE(date) AS d,
            SUM(time_to_resolve IS NOT NULL AND solvedate IS NOT NULL) AS com,
            SUM(time_to_resolve IS NOT NULL AND solvedate IS NOT NULL AND solvedate <= time_to_resolve) AS ok
       FROM glpi_tickets
      WHERE is_deleted = 0 AND date >= :start AND date < :end
      GROUP BY d ORDER BY d`,
    { start, end },
  );
  return rows.map((r) => ({ d: r.d, pct: pct(Number(r.ok), Number(r.com)) }));
}

// % de SLA por categoria (top 6 por volume) na janela.
export async function slaByCategory(start, end) {
  const rows = await glpiQuery(
    `SELECT COALESCE(c.completename,'Sem categoria') AS cat,
            SUM(t.time_to_resolve IS NOT NULL AND t.solvedate IS NOT NULL) AS com,
            SUM(t.time_to_resolve IS NOT NULL AND t.solvedate IS NOT NULL AND t.solvedate <= t.time_to_resolve) AS ok,
            COUNT(*) AS total
       FROM glpi_tickets t
       LEFT JOIN glpi_itilcategories c ON c.id = t.itilcategories_id
      WHERE t.is_deleted = 0 AND t.date >= :start AND t.date < :end
      GROUP BY cat HAVING com > 0 ORDER BY total DESC LIMIT 6`,
    { start, end },
  );
  return rows.map((r) => ({ cat: r.cat, pct: pct(Number(r.ok), Number(r.com)) }));
}

// Distribuição de chamados por categoria (rosca) na janela.
export async function distribution(start, end) {
  const rows = await glpiQuery(
    `SELECT COALESCE(c.completename,'Sem categoria') AS cat, COUNT(*) AS total
       FROM glpi_tickets t
       LEFT JOIN glpi_itilcategories c ON c.id = t.itilcategories_id
      WHERE t.is_deleted = 0 AND t.date >= :start AND t.date < :end
      GROUP BY cat ORDER BY total DESC`,
    { start, end },
  );
  return rows.map((r) => ({ cat: r.cat, total: Number(r.total) }));
}

// Total de tickets por semana (offset 0=esta semana .. 3=4 semanas atrás).
export async function weeklyTotals() {
  const rows = await glpiQuery(
    `SELECT FLOOR(TIMESTAMPDIFF(SECOND, date, NOW())/604800) AS wk, COUNT(*) AS total
       FROM glpi_tickets
      WHERE is_deleted = 0 AND date >= (NOW() - INTERVAL 28 DAY)
      GROUP BY wk`,
  );
  const out = [0, 0, 0, 0];
  for (const r of rows) { const w = Number(r.wk); if (w >= 0 && w <= 3) out[w] = Number(r.total); }
  return out; // índice = offset de semana
}
