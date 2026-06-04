// Mapeamentos entre o GLPI e o modelo do painel (colunas do Kanban, prioridade, SLA, canal).

// Status GLPI -> coluna do painel. (1 novo, 2 atribuído, 3 planejado, 4 pendente, 5 solucionado, 6 fechado)
export function statusToColumn(glpiStatus) {
  switch (Number(glpiStatus)) {
    case 1: return 'aberto';
    case 4: return 'aguardando_aprovacao';
    case 2:
    case 3: return 'em_execucao';
    case 5:
    case 6: return 'resolvido';
    default: return 'aberto';
  }
}

// Coluna do painel -> status GLPI (para gravar ao mover o card). 'violou_sla' é derivada: não grava.
export function columnToStatus(col) {
  return { aberto: 1, aguardando_aprovacao: 4, em_execucao: 2, resolvido: 5 }[col] || null;
}

// Prioridade GLPI (1..6) -> rótulo do painel.
export function priorityLabel(p) {
  p = Number(p);
  if (p <= 2) return 'Baixa';
  if (p === 3) return 'Média';
  if (p === 4) return 'Alta';
  return 'Crítica';
}

// % de SLA "restante" para a barra. null se o ticket não tem prazo (time_to_resolve).
export function slaPercent({ date, ttr, solvedate }) {
  if (!ttr) return null;
  const ttrMs = new Date(ttr).getTime();
  if (solvedate) return new Date(solvedate).getTime() <= ttrMs ? 100 : 0;
  const startMs = date ? new Date(date).getTime() : ttrMs;
  const now = Date.now();
  const total = ttrMs - startMs;
  if (total <= 0) return now <= ttrMs ? 100 : 0;
  const rem = ttrMs - now;
  return Math.max(0, Math.min(100, Math.round((rem / total) * 100)));
}

// Ticket não resolvido cujo prazo já passou = violou SLA (coluna derivada do Kanban).
export function isBreached({ glpiStatus, ttr, solvedate }) {
  const resolved = Number(glpiStatus) === 5 || Number(glpiStatus) === 6;
  if (resolved || !ttr) return false;
  return Date.now() > new Date(ttr).getTime();
}

// Sigla curta a partir do nome do setor (secretaria).
export function sectorSigla(sector) {
  if (!sector) return '—';
  const clean = sector.replace(/[^A-Za-zÀ-ÿ ]/g, '').trim();
  const words = clean.split(/\s+/).filter((w) => !['de', 'da', 'do', 'das', 'dos', 'e'].includes(w.toLowerCase()));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return clean.slice(0, 3).toUpperCase();
}

// Tempo relativo curto em pt-BR (ex.: "há 2d").
export function relTime(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return 'há ' + m + ' min';
  const h = Math.round(m / 60);
  if (h < 24) return 'há ' + h + 'h';
  return 'há ' + Math.round(h / 24) + 'd';
}
