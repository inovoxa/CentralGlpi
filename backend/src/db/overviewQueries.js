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
