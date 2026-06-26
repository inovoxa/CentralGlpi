// Configuração central: lê variáveis de ambiente uma vez e expõe um objeto tipado.
// Nada de segredos hardcoded — tudo vem do ambiente (Coolify / .env).
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function bool(v, def = false) {
  if (v == null || v === '') return def;
  return /^(1|true|yes|on)$/i.test(String(v));
}
function int(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
// Resolve STATIC_DIR: caminho absoluto é usado como está; relativo é a partir da raiz do backend.
function resolveStatic(v) {
  const raw = v && v.trim() ? v.trim() : '../sistema web';
  return path.isAbsolute(raw) ? raw : path.resolve(BACKEND_ROOT, raw);
}

const env = process.env;

export const config = {
  backendRoot: BACKEND_ROOT,
  port: int(env.PORT, 3000),
  host: env.HOST || '0.0.0.0',
  nodeEnv: env.NODE_ENV || 'development',
  isProd: (env.NODE_ENV || 'development') === 'production',
  staticDir: resolveStatic(env.STATIC_DIR),
  runMigrationsOnStart: bool(env.RUN_MIGRATIONS_ON_START, false),

  jwtSecret: env.JWT_SECRET || '',
  cookieSecret: env.COOKIE_SECRET || env.JWT_SECRET || '',
  totpEncKey: env.TOTP_ENC_KEY || '',
  totpIssuer: env.TOTP_ISSUER || 'Central GLPI',
  seedDefaultPassword: env.SEED_DEFAULT_PASSWORD || '',
  // Token de serviço aceito do proxy do Inovoxachat (Chatwoot) nas rotas GLPI.
  serviceToken: env.CENTRAL_SERVICE_TOKEN || '',

  login: {
    maxAttempts: int(env.LOGIN_MAX_ATTEMPTS, 5),
    lockoutMinutes: int(env.LOGIN_LOCKOUT_MINUTES, 5),
  },

  pg: {
    connectionString: env.DATABASE_URL || '',
    host: env.PG_HOST || 'localhost',
    port: int(env.PG_PORT, 5432),
    user: env.PG_USER || 'postgres',
    password: env.PG_PASSWORD || '',
    database: env.PG_DATABASE || 'Prefeitura_Municipal_de_Araraquara',
    schema: env.PG_SCHEMA || 'glpi_n8n',
  },

  glpi: {
    host: env.GLPI_DB_HOST || '',
    port: int(env.GLPI_DB_PORT, 3306),
    user: env.GLPI_DB_USER || '',
    password: env.GLPI_DB_PASSWORD || '',
    database: env.GLPI_DB_DATABASE || 'glpi',
    enabled: bool(env.GLPI_DB_HOST, false) || !!env.GLPI_DB_HOST,
    // API REST v1 (apirest) para escrita de tickets (mover Kanban). Tokens vêm de glpi_token_cache.
    apiV1Url: (env.GLPI_API_V1_URL || 'https://suporte.araraquara.sp.gov.br/api.php/v1').replace(/\/+$/, ''),
  },

  chatwoot: {
    url: env.CHATWOOT_URL || '',
    token: env.CHATWOOT_TOKEN || '',
    accountId: env.CHATWOOT_ACCOUNT_ID || '',
  },

  // Fatores de ROI estimado da tela Agente IA (ajustáveis).
  agente: {
    minPorOp: int(env.AGENTE_MIN_POR_OP, 25),   // minutos poupados por operação automatizada
    custoHora: int(env.AGENTE_CUSTO_HORA, 60),   // R$/hora de um técnico
  },

  ad: {
    host: env.AD_SSH_HOST || '',
    port: int(env.AD_SSH_PORT, 22),
    user: env.AD_SSH_USER || '',
    privateKeyPath: env.AD_SSH_PRIVATE_KEY_PATH || '',
    password: env.AD_SSH_PASSWORD || '',
    collectorCron: env.AD_COLLECTOR_CRON || '*/5 * * * *',
    scriptPath: env.AD_SCRIPT_PATH || 'C:\\Scripts\\Coletar_Auditoria_AD.ps1',
  },
};

// Validação mínima para subir em produção. Em dev, apenas avisa.
export function validateConfig(log) {
  const missing = [];
  if (!config.jwtSecret) missing.push('JWT_SECRET');
  if (!config.totpEncKey || config.totpEncKey.length < 64) {
    missing.push('TOTP_ENC_KEY (32 bytes em hex = 64 chars)');
  }
  if (missing.length) {
    const msg = `Configuração incompleta: faltam ${missing.join(', ')}.`;
    if (config.isProd) throw new Error(msg);
    log?.warn(`${msg} (ok em dev, mas defina antes de produção)`);
  }
}
