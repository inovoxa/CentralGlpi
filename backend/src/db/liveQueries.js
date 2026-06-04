// Feed de "Atividade ao vivo": eventos recentes derivados do chamados_log.
// Cada evento tem um id estável (string) para o front evitar duplicados ao fazer polling.
import { pgQuery } from './postgres.js';

// Eventos mais recentes (aberturas e execuções de AD), do mais novo ao mais antigo.
export async function recentEvents(limit = 40) {
  const r = await pgQuery(
    `(
       SELECT 'open-' || glpi_ticket_id AS id, 'abertura' AS type, created_at AS at,
              ('Chamado #' || glpi_ticket_id || ' aberto — ' || COALESCE(titulo,'')) AS msg
         FROM glpi_n8n.chamados_log
        WHERE created_at IS NOT NULL
        ORDER BY created_at DESC LIMIT $1
     )
     UNION ALL
     (
       SELECT 'ad-' || glpi_ticket_id AS id, 'exec' AS type, ad_executado_em AS at,
              ('Execução no AD concluída — ' || COALESCE(titulo,'#' || glpi_ticket_id)) AS msg
         FROM glpi_n8n.chamados_log
        WHERE ad_executado = TRUE AND ad_executado_em IS NOT NULL
        ORDER BY ad_executado_em DESC LIMIT $1
     )
     ORDER BY at DESC
     LIMIT $1`,
    [limit],
  );
  return r.rows.map((x) => ({ id: x.id, type: x.type, at: x.at, msg: x.msg }));
}
