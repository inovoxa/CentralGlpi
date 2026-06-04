// GET /api/agente — métricas e ROI estimado da automação conversacional.
import { config } from '../config.js';
import { monthStats, operacoesPorTipo, execMensal } from '../db/agenteQueries.js';

const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
async function safe(p, fb) { try { return await p; } catch { return fb; } }

function fmtDur(seg) {
  if (seg == null) return '—';
  if (seg < 3600) return `${Math.floor(seg / 60)}m ${Math.round(seg % 60)}s`;
  return `${Math.floor(seg / 3600)}h ${Math.round((seg % 3600) / 60)}m`;
}

export default async function agenteRoutes(fastify) {
  fastify.get('/api/agente', { preHandler: fastify.authenticate }, async () => {
    const [ms, ops, exMes] = await Promise.all([
      safe(monthStats(), { total: 0, conversas: 0, automated: 0, avgSeg: null }),
      safe(operacoesPorTipo(), []),
      safe(execMensal(), []),
    ]);

    const { minPorOp, custoHora } = config.agente;
    const horas = Math.round((ms.automated * minPorOp) / 60);
    const semHumanoPct = ms.total ? Math.round((ms.automated / ms.total) * 100) : null;

    return {
      cards: {
        conversas: ms.conversas,
        semHumanoPct,
        tempoMedio: fmtDur(ms.avgSeg),
        execucoesAD: ms.automated,
      },
      operacoes: ops,
      roi: { horas, economia: horas * custoHora, minPorOp, custoHora },
      horasMensais: {
        labels: exMes.map((m) => MES[Number(m.ym.split('-')[1]) - 1] || m.ym),
        data: exMes.map((m) => Math.round((m.total * minPorOp) / 60)),
      },
      generatedAt: new Date().toISOString(),
    };
  });
}
