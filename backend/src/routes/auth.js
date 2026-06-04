// Fluxo de autenticação em duas etapas: senha (argon2) → TOTP (otplib).
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { encryptSecret, decryptSecret } from '../lib/crypto.js';
import { publicUser } from '../lib/dto.js';
import {
  findByEmail, findById, recordFailedLogin, resetFailedLogin,
  setTotpSecret, enableTotp, touchLogin,
} from '../db/users.js';
import { logAccess } from '../db/audit.js';

const PARTIAL_TTL = 5 * 60;        // 5 min para concluir o TOTP
const SESSION_TTL = 8 * 60 * 60;   // 8 h de sessão completa

const GENERIC = 'E-mail ou senha inválidos.';

export default async function authRoutes(fastify) {
  // ---- Etapa 1: e-mail + senha ----
  fastify.post('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body || {};
    const ip = req.ip;
    const ua = req.headers['user-agent'];
    if (!email || !password) {
      return reply.code(400).send({ error: 'informe e-mail e senha' });
    }

    const user = await findByEmail(email);
    if (!user) {
      await logAccess({ email, action: 'login', result: 'falha', ip, userAgent: ua });
      return reply.code(401).send({ error: GENERIC });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await logAccess({ userId: user.id, email, action: 'login', result: 'bloqueado', ip, userAgent: ua });
      return reply.code(429).send({
        error: `Conta bloqueada até ${new Date(user.locked_until).toLocaleTimeString('pt-BR')} após várias tentativas.`,
      });
    }

    const ok = user.senha_hash ? await argon2.verify(user.senha_hash, password).catch(() => false) : false;
    if (!ok) {
      const st = await recordFailedLogin(user.id, config.login.maxAttempts, config.login.lockoutMinutes);
      await logAccess({ userId: user.id, email, action: 'login', result: 'falha', ip, userAgent: ua });
      const left = Math.max(0, config.login.maxAttempts - (st?.failed_attempts ?? 0));
      return reply.code(401).send({ error: GENERIC, attemptsLeft: left });
    }

    if (user.status && user.status !== 'ativo') {
      return reply.code(403).send({ error: 'Usuário inativo. Contate o administrador.' });
    }

    await resetFailedLogin(user.id);

    const payload = { uid: user.id, email: user.email, profile: user.profile, nome: user.nome };
    if (!user.totp_enabled) {
      reply.startSession(payload, 'totp_setup', PARTIAL_TTL);
      return { step: 'totp_setup' };
    }
    reply.startSession(payload, 'totp', PARTIAL_TTL);
    return { step: 'totp' };
  });

  // ---- Etapa 2a: gerar segredo + QR (1º acesso) ----
  fastify.post('/api/auth/totp/setup', { preHandler: fastify.requireStage('totp_setup') }, async (req, reply) => {
    const user = await findById(req.session.uid);
    if (!user) return reply.code(401).send({ error: 'sessão inválida' });

    const secret = authenticator.generateSecret();
    await setTotpSecret(user.id, encryptSecret(secret));
    const otpauth = authenticator.keyuri(user.email, config.totpIssuer, secret);
    const qr = await QRCode.toDataURL(otpauth);
    // `secret` também volta para digitação manual no app autenticador.
    return { otpauth, qr, secret };
  });

  // ---- Etapa 2b: confirmar código TOTP (vale para 1º acesso e logins seguintes) ----
  fastify.post('/api/auth/totp/verify', async (req, reply) => {
    const s = req.session;
    if (!s || (s.stage !== 'totp' && s.stage !== 'totp_setup')) {
      return reply.code(401).send({ error: 'sessão inválida para esta etapa' });
    }
    const { token } = req.body || {};
    if (!token) return reply.code(400).send({ error: 'informe o código de 6 dígitos' });

    const user = await findById(s.uid);
    if (!user || !user.totp_secret) return reply.code(401).send({ error: 'sessão inválida' });

    let valid = false;
    try {
      valid = authenticator.verify({ token: String(token).trim(), secret: decryptSecret(user.totp_secret) });
    } catch {
      valid = false;
    }
    if (!valid) {
      await logAccess({ userId: user.id, email: user.email, action: 'totp', result: 'falha', ip: req.ip, userAgent: req.headers['user-agent'] });
      return reply.code(401).send({ error: 'Código inválido ou expirado.' });
    }

    if (s.stage === 'totp_setup') await enableTotp(user.id);
    await touchLogin(user.id);
    await logAccess({ userId: user.id, email: user.email, action: 'login', result: 'sucesso', ip: req.ip, userAgent: req.headers['user-agent'] });

    reply.startSession(
      { uid: user.id, email: user.email, profile: user.profile, nome: user.nome },
      'authed',
      SESSION_TTL,
    );
    const fresh = await findById(user.id);
    return { user: publicUser(fresh) };
  });

  // ---- Logout ----
  fastify.post('/api/auth/logout', async (req, reply) => {
    if (req.session?.uid) {
      await logAccess({ userId: req.session.uid, email: req.session.email, action: 'logout', result: 'sucesso', ip: req.ip, userAgent: req.headers['user-agent'] });
    }
    reply.clearSession();
    return { ok: true };
  });
}
