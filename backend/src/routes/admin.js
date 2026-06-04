// Gestão (usuários, setores, status) e Logs de auditoria do painel.
import crypto from 'node:crypto';
import argon2 from 'argon2';
import {
  listUsuarios, countPorPerfil, createUsuario, updateUsuario, setSenha, resetTotp, removeUsuario,
  listAcesso, listOperacao, setoresEmUso,
} from '../db/adminQueries.js';
import { findByEmail } from '../db/users.js';
import { profileExists, PROFILES } from '../lib/rbac.js';
import { logOperation } from '../db/audit.js';
import { pgHealth } from '../db/postgres.js';
import { glpiHealth } from '../db/mysql.js';
import { chatwootReady } from '../chatwoot/client.js';
import { adEnabled } from '../ad/ssh.js';
import { config } from '../config.js';

const STATUS = ['ativo', 'inativo', 'bloqueado'];
const senhaForte = () => crypto.randomBytes(9).toString('base64url') + 'A1!';

function toCsv(rows, cols) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = cols.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => cols.map((c) => esc(c.get(r))).join(',')).join('\n');
  return '﻿' + head + '\n' + body; // BOM p/ Excel
}

export default async function adminRoutes(fastify) {
  // ---- Usuários ----
  fastify.get('/api/admin/usuarios', { preHandler: fastify.requirePerm('manage_users') }, async () => {
    const [usuarios, contagem] = await Promise.all([listUsuarios(), countPorPerfil()]);
    const porPerfil = Object.fromEntries(contagem.map((c) => [c.profile, c.total]));
    return { usuarios, porPerfil };
  });

  fastify.post('/api/admin/usuarios', { preHandler: fastify.requirePerm('manage_users') }, async (req, reply) => {
    const { nome, email, profile, sector } = req.body || {};
    if (!nome || !email || !profile) return reply.code(400).send({ error: 'nome, email e perfil são obrigatórios' });
    if (!profileExists(profile)) return reply.code(400).send({ error: 'perfil inválido' });
    if (await findByEmail(email)) return reply.code(409).send({ error: 'e-mail já cadastrado' });
    const senha = (req.body.senha && String(req.body.senha)) || senhaForte();
    const hash = await argon2.hash(senha, { type: argon2.argon2id });
    const id = await createUsuario({ nome, email: email.toLowerCase(), profile, sector, senhaHash: hash });
    await logOperation({ userId: req.session.uid, profile: req.session.profile, acao: `criou usuário do sistema`, delta: email, ip: req.ip });
    return { ok: true, id, senhaInicial: senha };
  });

  fastify.patch('/api/admin/usuarios/:id', { preHandler: fastify.requirePerm('manage_users') }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const { profile, sector, status } = req.body || {};
    if (profile && !profileExists(profile)) return reply.code(400).send({ error: 'perfil inválido' });
    if (status && !STATUS.includes(status)) return reply.code(400).send({ error: 'status inválido' });
    if (id === req.session.uid && status && status !== 'ativo') return reply.code(400).send({ error: 'não é possível inativar a própria conta' });
    await updateUsuario(id, { profile, sector, status });
    await logOperation({ userId: req.session.uid, profile: req.session.profile, acao: `editou usuário #${id}`, delta: [profile, sector, status].filter(Boolean).join(' '), ip: req.ip });
    return { ok: true };
  });

  fastify.post('/api/admin/usuarios/:id/reset-senha', { preHandler: fastify.requirePerm('manage_users') }, async (req) => {
    const id = parseInt(req.params.id, 10);
    const senha = (req.body && req.body.senha) || senhaForte();
    await setSenha(id, await argon2.hash(senha, { type: argon2.argon2id }));
    await logOperation({ userId: req.session.uid, profile: req.session.profile, acao: `redefiniu a senha do usuário #${id}`, ip: req.ip });
    return { ok: true, senhaInicial: senha };
  });

  fastify.post('/api/admin/usuarios/:id/reset-2fa', { preHandler: fastify.requirePerm('manage_users') }, async (req) => {
    const id = parseInt(req.params.id, 10);
    await resetTotp(id);
    await logOperation({ userId: req.session.uid, profile: req.session.profile, acao: `resetou o 2FA do usuário #${id}`, ip: req.ip });
    return { ok: true };
  });

  fastify.delete('/api/admin/usuarios/:id', { preHandler: fastify.requirePerm('manage_users') }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (id === req.session.uid) return reply.code(400).send({ error: 'não é possível excluir a própria conta' });
    await removeUsuario(id);
    await logOperation({ userId: req.session.uid, profile: req.session.profile, acao: `excluiu o usuário #${id}`, ip: req.ip });
    return { ok: true };
  });

  // ---- Logs ----
  fastify.get('/api/admin/logs/acesso', { preHandler: fastify.requirePerm('view_audit') }, async (req) =>
    ({ logs: await listAcesso(Math.min(1000, parseInt(req.query.limit, 10) || 300)) }));
  fastify.get('/api/admin/logs/operacao', { preHandler: fastify.requirePerm('view_audit') }, async (req) =>
    ({ logs: await listOperacao(Math.min(1000, parseInt(req.query.limit, 10) || 300)) }));

  fastify.get('/api/admin/logs/acesso.csv', { preHandler: fastify.requirePerm('export') }, async (req, reply) => {
    const csv = toCsv(await listAcesso(2000), [
      { label: 'Data/hora', get: (r) => r.created_at }, { label: 'Usuário', get: (r) => r.nome },
      { label: 'E-mail', get: (r) => r.email }, { label: 'Ação', get: (r) => r.action },
      { label: 'Resultado', get: (r) => r.result }, { label: 'IP', get: (r) => r.ip },
      { label: 'Dispositivo', get: (r) => r.user_agent }]);
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="logs_acesso.csv"').send(csv);
  });

  fastify.get('/api/admin/logs/operacao.csv', { preHandler: fastify.requirePerm('export') }, async (req, reply) => {
    const csv = toCsv(await listOperacao(2000), [
      { label: 'Data/hora', get: (r) => r.created_at }, { label: 'Usuário', get: (r) => r.nome },
      { label: 'Perfil', get: (r) => r.profile }, { label: 'Ação', get: (r) => r.acao },
      { label: 'Detalhe', get: (r) => r.delta }, { label: 'IP', get: (r) => r.ip }]);
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="logs_operacao.csv"').send(csv);
  });

  // ---- Setores em uso ----
  fastify.get('/api/admin/setores', { preHandler: fastify.requirePerm('manage_sectors') }, async () =>
    ({ setores: await setoresEmUso() }));

  // ---- Status do sistema (tela Configurações) ----
  fastify.get('/api/admin/status', { preHandler: fastify.requirePerm('config') }, async () => {
    const [pg, glpi] = await Promise.all([pgHealth(), glpiHealth()]);
    return {
      integracoes: {
        postgres: pg, glpi_mysql: glpi,
        chatwoot: { up: await chatwootReady() },
        active_directory: { up: adEnabled() },
      },
      parametros: {
        timezone: 'America/Sao_Paulo',
        login: config.login,
        totpIssuer: config.totpIssuer,
        agente: config.agente,
        perfis: Object.keys(PROFILES).length,
      },
    };
  });
}
