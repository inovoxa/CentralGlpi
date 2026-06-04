// Plugin de autenticação: cookie httpOnly + JWT, com "estágios" de sessão e RBAC.
//
// Estágios (claim `stage` do JWT):
//   - 'totp_setup' : senha ok, usuário ainda precisa cadastrar o TOTP (1º acesso)
//   - 'totp'       : senha ok, falta confirmar o código TOTP
//   - 'authed'     : sessão completa (senha + TOTP)
//
// Decorators expostos:
//   request.session            -> payload do JWT (ou null)
//   fastify.authenticate       -> preHandler: exige estágio 'authed'
//   fastify.requireStage(s)    -> preHandler: exige estágio s (para fluxo TOTP)
//   fastify.requirePerm(p)     -> preHandler: exige 'authed' + permissão p
//   reply.startSession(payload, stage, ttl) / reply.clearSession()
import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { config } from '../config.js';
import { can } from '../lib/rbac.js';

const COOKIE_NAME = 'sess';

async function authPlugin(fastify) {
  await fastify.register(cookie, { secret: config.cookieSecret || undefined });
  await fastify.register(jwt, {
    secret: config.jwtSecret || 'dev-insecure-secret-change-me',
    cookie: { cookieName: COOKIE_NAME, signed: false },
  });

  // Lê a sessão (se houver) em toda requisição, sem bloquear.
  fastify.decorateRequest('session', null);
  fastify.addHook('onRequest', async (req) => {
    try {
      req.session = await req.jwtVerify();
    } catch {
      req.session = null;
    }
  });

  // Inicia/atualiza a sessão emitindo o cookie.
  fastify.decorateReply('startSession', function (payload, stage, ttlSeconds) {
    const token = fastify.jwt.sign({ ...payload, stage }, { expiresIn: ttlSeconds });
    this.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      path: '/',
      maxAge: ttlSeconds,
    });
    return token;
  });

  fastify.decorateReply('clearSession', function () {
    this.clearCookie(COOKIE_NAME, { path: '/' });
  });

  // Exige sessão completa.
  fastify.decorate('authenticate', async function (req, reply) {
    if (!req.session || req.session.stage !== 'authed') {
      return reply.code(401).send({ error: 'não autenticado' });
    }
  });

  // Exige um estágio específico (fluxo de TOTP).
  fastify.decorate('requireStage', function (stage) {
    return async function (req, reply) {
      if (!req.session || req.session.stage !== stage) {
        return reply.code(401).send({ error: 'sessão inválida para esta etapa' });
      }
    };
  });

  // Exige autenticação + permissão RBAC.
  fastify.decorate('requirePerm', function (perm) {
    return async function (req, reply) {
      if (!req.session || req.session.stage !== 'authed') {
        return reply.code(401).send({ error: 'não autenticado' });
      }
      if (!can(req.session.profile, perm)) {
        return reply.code(403).send({ error: 'permissão negada', need: perm });
      }
    };
  });
}

export default fp(authPlugin, { name: 'auth' });
