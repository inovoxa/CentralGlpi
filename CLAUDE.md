# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains **n8n workflow automations** for the GLPI IT helpdesk system at **Prefeitura Municipal de Araraquara (LGTI)**. It is not a traditional software project — it consists of n8n workflow JSON files, a PostgreSQL setup script, a PowerShell script, a form-definitions data file, and documentation.

The system provides two parallel entry points for IT requests, both feeding the same downstream AD/Exchange automation:

1. **WhatsApp virtual assistant** (Chatwoot → AI Agent → sub-workflows) — opens, queries, and updates GLPI tickets conversationally.
2. **GLPI self-service form catalog** (25 forms provisioned in the GLPI 11 Form Editor) — users submit a structured form, a ticket is created, and the scheduler workflow mirrors it back into `chamados_log` so the same AD automation pipeline can pick it up.

## Architecture

```
WhatsApp → Chatwoot → n8n 01_Agente_Principal
                           ├── 02_GLPI_Auth          (OAuth2 token cache → PostgreSQL)
                           ├── 03_Verificar_Usuario
                           ├── 04_Criar_Usuario       (cat 15)
                           ├── 05_Reset_Senha         (cat 16)
                           ├── 06_Reativar_Usuario    (cat 17)
                           ├── 07_Desativar_Usuario   (cat 18)
                           ├── 08_Acesso_Pasta        (cat 19)
                           ├── 09_Chamado_Informatica (cats 23–33, 11 subtipos)
                           ├── 09B_Chamado_Saude      (cats 34–36)
                           ├── 10_Chamado_Telefonia   (cats 37–40)
                           ├── 11_Consultar_Chamado
                           ├── 12_Atualizar_Chamado
                           ├── 13_Notificar_Resposta
                           ├── 14_Executar_AD         (SSH → Windows Server PowerShell)
                           ├── 15_Transferencia_Setor (cat 22)
                           ├── 16_Criar_Email         (cat 20)
                           ├── 17_Limpar_Historico
                           └── 18_Base_Conhecimento   (FAQ — busca KnowbaseItem via API v1)

GLPI Form Catalog (parallel entry):
   GLPI 11 Form (25 forms)  ──► Ticket created in GLPI
                                      │
                                      ▼
                           20_Espelhar_Tickets_Formcreator
                           (scheduler, 5 min, API v1)
                                      │
                                      ▼
                              chamados_log table
                                      │
                                      ▼
                              14_Executar_AD (same as above)

Provisioning & maintenance workflows (manual-trigger, one-shot):
   19_Provisionar_Formularios   ◄── formularios_definicoes.json
   21_Purge_Formularios          (delete the 25 forms)
   22_Reconfig_Destinations      (set categoria/urgency/impact on destinations)
   23_Inspecionar_Destination    (debug: dump 1 destination config)
   24_Inspecionar_Ticket         (debug: dump ticket payload)
```

Total: **24 active workflows** (01–24). WF18 was repurposed: the old Reset_Email_Pessoal was removed (Exchange mailbox password reset reuses the standard AD reset path 1.2), and `18_GLPI_Base_Conhecimento` now provides the WhatsApp **knowledge-base/FAQ** lookup (option 3 of the main menu), called by the agent as the `Base_Conhecimento` tool.

**WhatsApp main menu (WF01):** the first message presents a level-1 menu — `1️⃣ Abertura de chamado`, `2️⃣ Consulta de chamado`, `3️⃣ Base de conhecimento (FAQ)`. Only after option 1 does the agent show the full service catalog (1.x–4.x); option 2 routes to `Consultar_Chamado`, option 3 to `Base_Conhecimento`.

**Aviso de aprovação ao superior (WF20):** for approval-category form tickets (cats 15–20, 22), WF20 looks up the superior's **Mobile** in GLPI by `email_superior` (via `UserEmail` → `User`), stores it in `chamados_log.superior_whatsapp`, and sends a "pending approval" WhatsApp via the Chatwoot REST API (creds in `glpi_token_cache.chatwoot_url`/`chatwoot_token`).

**Stack:**
- **AI Agent**: OpenRouter (deepseek/deepseek-v3.2) via `@n8n/n8n-nodes-langchain.lmChatOpenRouter`
- **WhatsApp Bridge**: Chatwoot (fazer.ai community node)
- **Audio TTS**: ElevenLabs Flash v2.5
- **Audio STT**: OpenAI Whisper
- **Database**: PostgreSQL — schema `glpi_n8n` (tables: `glpi_token_cache`, `glpi_categorias`, `chamados_log`)
- **GLPI APIs (both in use)**:
  - **v2** at `suporte.araraquara.sp.gov.br/api.php/v2` with OAuth2 (used by main WhatsApp pipeline)
  - **v1** at `suporte.araraquara.sp.gov.br/apirest.php` with App-Token + user_token (used by WF19–23 for Form Editor admin and by WF20 because the v2 ticket search does not return recent tickets)
- **AD/Exchange execution**: PowerShell via SSH (`14_GLPI_Executar_AD` → `Executar_AD_Automatico.ps1` on Windows Server)

## Deployment

There is no build step. Deployment is manual:

1. **Database**: Run `setup_completo.sql` against `Prefeitura_Municipal_de_Araraquara`:
   ```bash
   psql -U postgres -d Prefeitura_Municipal_de_Araraquara \
     -v client_id='<OAuth2 client_id>' \
     -v client_secret='<OAuth2 client_secret>' \
     -v glpi_password='<senha do usuário Automacao>' \
     -v user_token='<user_token API v1>' \
     -v app_token='<App-Token REST v1, usado pelos WF19-24>' \
     -v app_token_v2='<App-Token OAuth2 v2 /token, usado pelo WF02>' \
     -v chatwoot_url='<base URL do Chatwoot, usada pelo WF20>' \
     -v chatwoot_token='<api_access_token do Chatwoot (Perfil > Access Token)>' \
     -f setup_completo.sql
   ```
   Credentials are no longer stored in the file — they must be passed with `-v`
   (see the header comment in `setup_completo.sql`). There are **two distinct
   App-Tokens**: `app_token` (REST v1, read by WF19–24 from
   `glpi_token_cache.app_token`) and `app_token_v2` (OAuth2 v2 `/token`, read by
   WF02 from `glpi_token_cache.app_token_v2`). Do not swap them.
   Expected result: 29 categories, counts `1=7, 2=11, 3=3, 4=4`.

2. **n8n workflows**: Import all JSON files via the n8n UI. After import:
   - Reconnect all credentials: `Prefeitura_PG` / `GLPI PMA`, `OpenRouter account GLPÍ`, `Chatwoot fazer.ai restaurante 01`, SSH credential for Windows AD.
   - In every sub-workflow (03–16), open the `Chamar Auth` node and select `02_GLPI_Auth` from the dropdown (the `WF_02_AUTH_ID` placeholder is not auto-resolved).
   - In `01_GLPI_Agente_Principal`, open the `Base_Conhecimento` tool node and select `18_GLPI_Base_Conhecimento` (the `WF18_KB_ID` placeholder is not auto-resolved).

3. **Windows Server**: Replace `C:\Scripts\Executar_AD_Automatico.ps1` with the updated file from this repo.

4. **GLPI form catalog (only on first install or when forms change)**:
   - Run `19_GLPI_Provisionar_Formularios` once to create the 25 forms from `formularios_definicoes.json`.
   - Run `22_GLPI_Reconfig_Destinations` to apply category/urgency/impact/priority on every destination.
   - Activate `20_GLPI_Espelhar_Tickets_Formcreator` (scheduler) so submissions land in `chamados_log`.

## Key Files

| File | Purpose |
|---|---|
| `01_GLPI_Agente_Principal.json` | Main AI agent — system prompt, tool definitions, menu logic |
| `02_GLPI_Auth.json` | OAuth2 token acquisition with PostgreSQL caching |
| `14_GLPI_Executar_AD.json` | Triggers AD/Exchange PowerShell via SSH after GLPI ticket approval |
| `19_GLPI_Provisionar_Formularios.json` | Creates 25 forms in GLPI 11 Form Editor (consumes `formularios_definicoes.json`) |
| `20_GLPI_Espelhar_Tickets_Formcreator.json` | Scheduler (5 min) — finds form-generated tickets and inserts them into `chamados_log` |
| `22_GLPI_Reconfig_Destinations.json` | Bulk-updates destination config for the 25 forms (category 15–40, urgency, impact, priority) |
| `Executar_AD_Automatico.ps1` | PowerShell script on Windows Server — handles Criar/Reset/Reativar/Desativar/AcessoPasta/Transferir/CriarEmail |
| `setup_completo.sql` | Idempotent DB setup: token cache, OAuth2 credentials, category table (29 items), chamados_log columns |
| `formularios_definicoes.json` | Data-only definition of 25 forms (sections, questions, validation, GLPI category mapping) — consumed by WF19 |

## `chamados_log` is the pivot table

This is the central state table. Both entry paths (WhatsApp agent and Form Editor scheduler) insert rows into `glpi_n8n.chamados_log`, and WF14 reads from it to execute the AD/Exchange operation. When debugging "the user submitted but nothing happened":

1. Did the ticket make it to GLPI? Check via WF24 or the GLPI UI.
2. Is there a row in `chamados_log` for that ticket? If not, WF20 didn't pick it up (scheduler off, ticket name doesn't start with `Solicitacao - `, or the category isn't in the allowed list).
3. Is `executado_ad` still null? WF14 hasn't processed it yet — check SSH credential and Windows Server availability.

## Known Issues (open, not yet fixed)

- **`neverError: true` on OAuth2** — auth failures in WF02 are silently suppressed.
- **WF20 uses v1 API** because the v2 ticket search is broken for the recent-tickets case. If v2 is ever fixed, WF20 should be migrated to keep auth consistent with the rest of the pipeline.
- **Provisional password delivered in plaintext** over WhatsApp/Chatwoot — mitigated by `ChangePasswordAtLogon`, but consider a safer channel/expiry.

## Security hardening (done — 2026-05-29)

- **SQL injection fixed** — all `Log no Banco` nodes (WF04–16) and the WF14 ticket SELECT now use parameterized queries (`$1…$12` via `options.queryReplacement`); no more string interpolation or manual `.replace("''")`. WF03 has no insert; WF20 already used native Insert mode.
- **Credentials removed from code** — `user_token`/`app_token` literals deleted from WF19–24; each now reads them from `glpi_token_cache` via a `Carregar Tokens` Postgres node (`$('Carregar Tokens').first().json…`). `setup_completo.sql` no longer hardcodes any secret (passed via `-v`). **Rotate the previously-committed credentials in GLPI/AD** — treat them as compromised.
- **LDAP injection fixed** — `Executar_AD_Automatico.ps1` validates every identifier (`login`, `perfil_referencia`, `nome_completo`) against an allowlist (`Assert-IdentificadorSeguro`) before any `Get-ADUser -Filter`/`-Identity`.
- **Strong provisional passwords** — `Gerar-Senha` now produces 14-char passwords with all 4 character classes using a cryptographic RNG.
- **Folder allowlist** — `Executar-AcessoPasta` only grants ACLs under `$PastasPermitidas` (edit the `D:\` roots before publishing); blocks path traversal.

## GLPI Category Map (current)

| Menu | Subtype | Category ID |
|---|---|---|
| 1.1–1.7 | Usuários e Acessos (7 items) | 15–20, 22 |
| 2.1–2.11 | Suporte de Informática | 23–33 |
| 3.1–3.3 | Sistemas da Saúde | 34–36 |
| 4.1–4.4 | Telefonia | 37–40 |

Notes:
- Item 1.7 is **Transferência de Setor** (category ID 22) — the user menu shows it as 1.7 but the GLPI category ID is non-contiguous.
- Category ID 21 was removed from the SQL setup (formerly Reset E-mail Pessoal).
- The same category IDs are referenced from three different places: `setup_completo.sql` (DB), `formularios_definicoes.json` (form provisioning), and the `MAPA` constant inside WF22. Keep all three in sync when adding/removing categories.

## n8n Credential Names (must match exactly)

| Credential | Type |
|---|---|
| `Prefeitura_PG` or `GLPI PMA` | PostgreSQL |
| `OpenRouter account GLPÍ` | OpenRouter |
| `Chatwoot fazer.ai restaurante 01` | Chatwoot |
| SSH credential (WF14) | SSH key to Windows AD server |
