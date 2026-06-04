// GET /api/live — eventos recentes para a Atividade ao vivo (polling do front).
import { recentEvents } from '../db/liveQueries.js';

export default async function liveRoutes(fastify) {
  fastify.get('/api/live', { preHandler: fastify.authenticate }, async () => {
    let events = [];
    try { events = await recentEvents(40); } catch { events = []; }
    return { events, generatedAt: new Date().toISOString() };
  });
}
