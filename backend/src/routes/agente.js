// GET /api/agente?period=7d|30d|90d — métricas e ROI estimado da automação.
import { config } from '../config.js';
import { periodStats, operacoesPorTipo, execDiario } from '../db/agenteQueries.js';

const DAYS = { '7d': 7, '30d': 30, '90d': 90 };
const DAY_MS = 86_400_000;
async function safe(p, fb) { try { return await p; } catch { return fb; } }
const pad = (n) => String(n).padStart(2, '0');
const ddmm = (s) => { const d = new Date(s + 'T00:00:00'); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };

function fmtDur(seg) {
  if (seg == null) return '—';
  if (seg < 3600) return `${Math.floor(seg / 60)}m ${Math.round(seg % 60)}s`;
  return `${Math.floor(seg / 3600)}h ${Math.round((seg % 3600) / 60)}m`;
}

export default async function agenteRoutes(fastify) {
  fastify.get('/api/agente', { preHandler: fastify.authenticate }, async (req) => {
    const period = DAYS[req.query.period] ? req.query.period : '7d';
    const startIso = new Date(Date.now() - DAYS[period] * DAY_MS).toISOString();

    const [ms, ops, diario] = await Promise.all([
      safe(periodStats(startIso), { total: 0, conversas: 0, automated: 0, avgSeg: null }),
      safe(operacoesPorTipo(startIso), []),
      safe(execDiario(startIso), []),
    ]);

    const { minPorOp, custoHora } = config.agente;
    const horas = Math.round((ms.automated * minPorOp) / 60);
    const semHumanoPct = ms.total ? Math.round((ms.automated / ms.total) * 100) : null;

    return {
      period,
      cards: {
        conversas: ms.conversas,
        semHumanoPct,
        tempoMedio: fmtDur(ms.avgSeg),
        execucoesAD: ms.automated,
      },
      operacoes: ops,
      roi: { horas, economia: horas * custoHora, minPorOp, custoHora },
      horasMensais: {
        labels: diario.map((x) => ddmm(x.dia)),
        data: diario.map((x) => Math.round((x.total * minPorOp) / 60)),
      },
      generatedAt: new Date().toISOString(),
    };
  });
}
