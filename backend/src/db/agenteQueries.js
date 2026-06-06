// Métricas do Agente IA, a partir de chamados_log (+ glpi_categorias). Tudo PostgreSQL.
// Janela parametrizada por startIso (ISO timestamp).
import { pgQuery } from './postgres.js';

// Estatísticas na janela [startIso, agora).
export async function periodStats(startIso) {
  const r = await pgQuery(
    `SELECT
       COUNT(*)::int                                   AS total,
       COUNT(DISTINCT conversa_id)::int                AS conversas,
       COUNT(*) FILTER (WHERE ad_executado)::int       AS automated,
       AVG(EXTRACT(EPOCH FROM (ad_executado_em - created_at)))
         FILTER (WHERE ad_executado AND ad_executado_em IS NOT NULL AND created_at IS NOT NULL) AS avg_seg
     FROM glpi_n8n.chamados_log
     WHERE created_at >= $1`,
    [startIso],
  );
  const x = r.rows[0] || {};
  return {
    total: x.total || 0,
    conversas: x.conversas || 0,
    automated: x.automated || 0,
    avgSeg: x.avg_seg != null ? Number(x.avg_seg) : null,
  };
}

// Operações por tipo na janela, nome vindo de glpi_categorias.
export async function operacoesPorTipo(startIso) {
  const r = await pgQuery(
    `SELECT COALESCE(cat.nome, 'Categoria ' || cl.glpi_category_id) AS nome, COUNT(*)::int AS total
       FROM glpi_n8n.chamados_log cl
       LEFT JOIN glpi_n8n.glpi_categorias cat ON cat.glpi_category_id = cl.glpi_category_id
      WHERE cl.created_at >= $1
      GROUP BY 1 ORDER BY total DESC LIMIT 10`,
    [startIso],
  );
  return r.rows.map((x) => ({ nome: x.nome, total: Number(x.total) }));
}

// Execuções de AD por dia na janela (para o gráfico de horas economizadas/dia).
export async function execDiario(startIso) {
  const r = await pgQuery(
    `SELECT to_char(date_trunc('day', ad_executado_em), 'YYYY-MM-DD') AS dia, COUNT(*)::int AS total
       FROM glpi_n8n.chamados_log
      WHERE ad_executado AND ad_executado_em >= $1
      GROUP BY dia ORDER BY dia`,
    [startIso],
  );
  return r.rows.map((x) => ({ dia: x.dia, total: Number(x.total) }));
}
