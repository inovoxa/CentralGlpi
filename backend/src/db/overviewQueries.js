// Consultas à chamados_log (PostgreSQL) para a Visão Geral.
// Filtro de setor é aplicado sobre a coluna `secretaria` (ILIKE, tolerante).
import { pgQuery } from './postgres.js';

// Execuções de AD concluídas na janela [startIso, endIso). Opcional: setor.
export async function countExecucoesAD(startIso, endIso, sector) {
  const params = [startIso, endIso];
  let clause = '';
  if (sector) { params.push('%' + sector + '%'); clause = ' AND secretaria ILIKE $3'; }
  const r = await pgQuery(
    `SELECT COUNT(*)::int AS c
       FROM glpi_n8n.chamados_log
      WHERE ad_executado = TRUE AND ad_executado_em >= $1 AND ad_executado_em < $2${clause}`,
    params,
  );
  return r.rows[0]?.c ?? 0;
}

// Última desativação registrada (categoria GLPI 18 = Desativação de Usuário).
export async function lastDesativacao(sector) {
  const params = [];
  let clause = '';
  if (sector) { params.push('%' + sector + '%'); clause = ' AND secretaria ILIKE $1'; }
  const r = await pgQuery(
    `SELECT solicitante_nome, solicitante_matricula, created_at
       FROM glpi_n8n.chamados_log
      WHERE glpi_category_id = 18${clause}
      ORDER BY created_at DESC
      LIMIT 1`,
    params,
  );
  const x = r.rows[0];
  return x ? { nome: x.solicitante_nome, matricula: x.solicitante_matricula, when: x.created_at } : null;
}

// Chamados por semana e por canal (offset 0=esta semana .. 3=4 semanas atrás).
// WhatsApp = veio de conversa (conversa_id); Formulário = sem conversa.
export async function weeklyChannelLog() {
  const r = await pgQuery(
    `SELECT FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 604800)::int AS wk,
            COUNT(*) FILTER (WHERE conversa_id IS NOT NULL) AS wa,
            COUNT(*) FILTER (WHERE conversa_id IS NULL)     AS form
       FROM glpi_n8n.chamados_log
      WHERE created_at >= now() - interval '28 days'
      GROUP BY wk`,
  );
  const wa = [0, 0, 0, 0]; const form = [0, 0, 0, 0];
  for (const x of r.rows) { const w = Number(x.wk); if (w >= 0 && w <= 3) { wa[w] = Number(x.wa); form[w] = Number(x.form); } }
  return { wa, form };
}

// Última execução de AD concluída (qualquer categoria).
export async function lastExecucaoAD(sector) {
  const params = [];
  let clause = '';
  if (sector) { params.push('%' + sector + '%'); clause = ' AND secretaria ILIKE $1'; }
  const r = await pgQuery(
    `SELECT titulo, ad_executado_em
       FROM glpi_n8n.chamados_log
      WHERE ad_executado = TRUE${clause}
      ORDER BY ad_executado_em DESC
      LIMIT 1`,
    params,
  );
  const x = r.rows[0];
  return x ? { titulo: x.titulo, when: x.ad_executado_em } : null;
}
