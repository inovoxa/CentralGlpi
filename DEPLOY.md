# Deploy — Central de Operações GLPI

O backend (Fastify) serve a `sistema web/` e a API. Ele **conecta aos serviços que já
existem** (PostgreSQL do n8n, MySQL do GLPI, Chatwoot, Domain Controller) — não sobe banco novo,
pois compartilha o schema `glpi_n8n`/`chamados_log` com o n8n.

## Opção A — Docker Compose (recomendado)

`docker-compose.yml` na raiz builda o backend e lê as variáveis do ambiente.

### No Coolify
1. Novo recurso → **Docker Compose** → repositório `inovoxa/CentralGlpi`, branch `main`.
2. Compose file: `docker-compose.yml` (raiz).
3. Em **Environment Variables**, preencha (base em `backend/.env.example`):
   - Segredos: `JWT_SECRET`, `COOKIE_SECRET`, `TOTP_ENC_KEY` (cada um = `openssl rand -hex 32`).
   - `PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE/PG_SCHEMA` (o **mesmo** Postgres do n8n).
   - `GLPI_DB_*` (usuário MySQL **somente-SELECT**), `GLPI_API_V1_URL`.
   - Opcionais: `CHATWOOT_*`, `AD_SSH_*` + `AD_SCRIPT_PATH`.
4. Defina o **domínio com HTTPS** no serviço.
5. Deploy. Com `RUN_MIGRATIONS_ON_START=true` (já no compose) as tabelas são criadas no boot.
6. **Seed inicial** (uma vez), no terminal do container:
   ```bash
   npm run seed     # imprime a senha inicial dos usuários — ANOTE
   ```

### Em um host com Docker (sem Coolify)
```bash
git clone https://github.com/inovoxa/CentralGlpi.git && cd CentralGlpi
cp backend/.env.example .env     # edite a .env da RAIZ com seus valores
docker compose up -d --build
docker compose exec central-glpi npm run seed
```
Acesse `http://HOST:3000` (em produção, ponha um proxy HTTPS na frente — ver gotcha 1).

## Opção B — Dockerfile puro
Coolify tipo **Dockerfile**: Base Directory `/`, Dockerfile `backend/Dockerfile`, porta `3000`,
e as mesmas variáveis. Rode `npm run migrate` e `npm run seed` uma vez no terminal do container.

## Domain Controller (auditoria de AD — opcional)
Copie `Coletar_Auditoria_AD.ps1` para `C:\Scripts\` no DC (salvar como **UTF-8 com BOM**) e
garanta acesso SSH do backend ao DC. Sem `AD_SSH_HOST`, o coletor fica desligado e o resto roda.

## ⚠️ Tropeços comuns
1. **HTTPS obrigatório.** Em produção o cookie de sessão é `Secure`; por HTTP o login não persiste.
   Acesse pelo domínio HTTPS (o backend já tem `trustProxy` para o proxy do Coolify).
2. **Rede até os serviços.** `GET /api/health` mostra o estado de PostgreSQL e MySQL GLPI — comece por aí.
3. **Chave SSH no container.** Se usar `AD_SSH_PRIVATE_KEY_PATH`, monte o arquivo da chave (volume);
   senão use `AD_SSH_PASSWORD`.

## Validação pós-deploy
1. `https://SEU-DOMINIO/api/health` → `status: ok` e veja `deps`.
2. Login (e-mail do seed + senha do `npm run seed`) → QR no Google Authenticator → código de 6 dígitos.
3. Configurações mostra a saúde das integrações; Chamados/Visão Geral trazem dados do GLPI.
