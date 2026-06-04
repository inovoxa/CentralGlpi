# Central de Operações GLPI · Prefeitura Municipal de Araraquara

Plataforma web de **monitoramento e gestão** da automação de TI da Prefeitura de Araraquara,
desenvolvida pela **[Inovoxa](https://inovoxa.com.br)**.

Acompanha, em um só lugar:

- Atendimento via **WhatsApp (Chatwoot)** com agente de IA conversacional
- Formulários **GLPI 11** (25 formulários)
- **23 workflows n8n** orquestrando o atendimento
- Execução automática no **Active Directory / Exchange** (SSH + PowerShell)
- Integração **SMARAPD (RH)** para detecção de desligamentos
- **PostgreSQL** como fonte de verdade (`chamados_log`)

> ℹ️ A **autenticação já é real** (login + senha + TOTP), servida pelo backend Fastify em
> `../backend`. As demais telas (dashboard, kanban, SLA, chamados, conversas, agente) ainda
> usam dados *mock* e serão integradas ao GLPI/AD/Chatwoot nas próximas fases.

## Como executar

O front é servido **pelo backend** (ele expõe a API `/api/*` e o `index.html` na mesma origem).
Não use mais `python -m http.server` — sem a API o login não funciona.

```bash
cd ../backend
cp .env.example .env   # configure JWT_SECRET, TOTP_ENC_KEY, PG_*
npm install && npm run migrate && npm run seed
npm start              # http://localhost:3000  (serve este index.html)
```

Em produção, roda em container no Coolify (ver `../backend/README.md`).
Os arquivos `BrasaoAraraquara.png` e `Background_GLPI.jpeg` ficam nesta pasta e são servidos junto.

## Acesso (login real)

Os usuários são criados pelo `npm run seed` com uma **senha inicial** (impressa no console).
No **primeiro acesso**, cada um escaneia o QR no **Google Authenticator** e confirma o código de
6 dígitos; nos acessos seguintes, basta senha + código.

Usuários do seed inicial:

| E-mail | Perfil |
|---|---|
| `fabricio@araraquara.sp.gov.br` | Admin |
| `admin@araraquara.sp.gov.br` | Admin |
| `coordenador@araraquara.sp.gov.br` | Coordenador TI |
| `tecnico@araraquara.sp.gov.br` | Técnico |
| `gestor.saude@araraquara.sp.gov.br` | Gestor de Setor (Saúde) |
| `auditor@araraquara.sp.gov.br` | Auditor (somente leitura) |

Dentro do sistema, use o menu do avatar → **"Visualizar como"** para alternar perfis e ver
a interface se adaptar às permissões (simulação de UI; as permissões reais vêm do servidor).

## Funcionalidades

- Login + RBAC com 5 perfis e permissões granulares
- Dashboard, Kanban (drag-and-drop), SLA & métricas (Chart.js), atividade ao vivo
- Lista de chamados, **histórico de conversas** (estilo WhatsApp, com áudio e intervenção humana)
- Painel do Agente IA (ROI, operações)
- Gestão: usuários do sistema, perfis, setores, configurações
- Auditoria: logs de acesso, logs de operação, relatórios

## Stack (front-end)

HTML + CSS + JS puro · [Chart.js](https://www.chartjs.org/) · [Tabler Icons](https://tabler.io/icons) · Google Fonts (Outfit, JetBrains Mono) — tudo via CDN, sem build step.

---

© 2026 Prefeitura Municipal de Araraquara · Central GLPI v2.0 · desenvolvido por **Inovoxa**
