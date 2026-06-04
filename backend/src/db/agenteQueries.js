// Métricas do Agente IA, a partir de chamados_log (+ glpi_categorias). Tudo PostgreSQL.
import { pgQuery } from './postgres.js';

// Estatísticas do mês corrente.
export async function monthStats() {
  const r = await pgQuery(
    `SELECT
       COUNT(*)::int                                   AS total,
       COUNT(DISTINCT conversa_id)::int                AS conversas,
       COUNT(*) FILTER (WHERE ad_executado)::int       AS automated,
       AVG(EXTRACT(EPOCH FROM (ad_executado_em - created_at)))
         FILTER (WHERE ad_executado AND ad_executado_em IS NOT NULL AND created_at IS NOT NULL) AS avg_seg
     FROM glpi_n8n.chamados_log
     WHERE created_at >= date_trunc('month', now())`,
  );
  const x = r.rows[0] || {};
  return {
    total: x.total || 0,
    conversas: x.conversas || 0,
    automated: x.automated || 0,
    avgSeg: x.avg_seg != null ? Number(x.avg_seg) : null,
  };
}

// Operações por tipo (últimos 6 meses), nome vindo de glpi_categorias.
export async function operacoesPorTipo() {
  const r = await pgQuery(
    `SELECT COALESCE(cat.nome, 'Categoria ' || cl.glpi_category_id) AS nome, COUNT(*)::int AS total
       FROM glpi_n8n.chamados_log cl
       LEFT JOIN glpi_n8n.glpi_categorias cat ON cat.glpi_category_id = cl.glpi_category_id
      WHERE cl.created_at >= now() - interval '6 months'
      GROUP BY 1 ORDER BY total DESC LIMIT 10`,
  );
  return r.rows.map((x) => ({ nome: x.nome, total: Number(x.total) }));
}

// Execuções de AD por mês (últimos 6 meses).
export async function execMensal() {
  const r = await pgQuery(
    `SELECT to_char(date_trunc('month', ad_executado_em), 'YYYY-MM') AS ym, COUNT(*)::int AS total
       FROM glpi_n8n.chamados_log
      WHERE ad_executado AND ad_executado_em >= date_trunc('month', now()) - interval '5 months'
      GROUP BY ym ORDER BY ym`,
  );
  return r.rows.map((x) => ({ ym: x.ym, total: Number(x.total) }));
}
