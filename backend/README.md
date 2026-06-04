# Central de Operações GLPI — Backend

Backend em **Node.js + Fastify** que serve o painel (`../sistema web/index.html`) e expõe
a API. Substitui a lógica mock do protótipo por dados reais (PostgreSQL, MySQL do GLPI,
AD via SSH, Chatwoot). Roda em container no **Coolify**.

> Status: **Fase 0** (fundação + deploy) e **Fase 1** (autenticação real + TOTP + RBAC).
> Demais fases (GLPI em tempo real, Kanban/SLA/live, Chatwoot, Agente IA, Auditoria AD)
> entram nas próximas entregas — ver `../../.claude/plans/abstract-yawning-tiger.md`.

## Rodando localmente

```bash
cd backend
cp .env.example .env        # preencha JWT_SECRET, TOTP_ENC_KEY e PG_*
npm install
npm run migrate             # cria tabelas + seed de usuários (no PostgreSQL)
npm run seed                # define a senha inicial (imprime no console)
npm start                   # http://localhost:3000
```

Gerar segredos:

```bash
openssl rand -hex 32   # use para JWT_SECRET e (outro) para TOTP_ENC_KEY
```

Sem PostgreSQL configurado o servidor ainda sobe; só as rotas de dados falham.
`GET /api/health` mostra o estado de cada dependência.

## Deploy no Coolify

- **Tipo:** Dockerfile.
- **Build context / Base Directory:** raiz do repositório (precisa enxergar `sistema web/`).
- **Dockerfile Location:** `backend/Dockerfile`.
- **Porta:** 3000.
- **Environment Variables:** copie de `.env.example` (defina os segredos no Coolify, não no código).
- Após o primeiro deploy, rode `npm run migrate` e `npm run seed` uma vez
  (terminal do container ou um job), ou aplique a migração no PostgreSQL manualmente.

## Fluxo de autenticação (Fase 1)

1. `POST /api/auth/login` `{ email, password }` → `{ step: 'totp' | 'totp_setup' }`
   (senha via **argon2**; lockout por usuário no banco após `LOGIN_MAX_ATTEMPTS`).
2. **1º acesso:** `POST /api/auth/totp/setup` → `{ qr, otpauth, secret }` (mostra QR do Google Authenticator).
3. `POST /api/auth/totp/verify` `{ token }` → cria a sessão (cookie httpOnly) e devolve o usuário.
4. `GET /api/me` → usuário atual + catálogo de RBAC. `POST /api/auth/logout` encerra.

Segredo TOTP é cifrado em repouso (AES-256-GCM, chave `TOTP_ENC_KEY`).

## Estrutura

```
backend/
  src/
    server.js            # bootstrap Fastify
    config.js            # leitura de env
    db/                  # postgres.js, mysql.js (GLPI RO), users.js, audit.js
    lib/                 # rbac.js, crypto.js, dto.js
    plugins/             # auth.js (cookie+JWT+estágios+RBAC)
    routes/              # health.js, auth.js, me.js
    scripts/             # migrate.js, seed.js
  migrations/            # 001_app_auth.sql (idempotente)
  Dockerfile  docker-compose.yml  .env.example
```
