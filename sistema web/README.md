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

> ⚠️ Esta é a **interface de demonstração** (front-end). Toda a lógica é *client-side*
> com dados em memória (mock) — não há back-end nem dados reais nesta versão.

## Como executar

É um único arquivo HTML autocontido. Basta abrir o `index.html` no navegador
(ou servir a pasta):

```bash
# opção simples
python -m http.server 8080
# acesse http://localhost:8080
```

Os arquivos `BrasaoAraraquara.png` e `Background_GLPI.jpeg` devem ficar na **mesma pasta**
do `index.html`.

## Acessos de demonstração

Qualquer e-mail `@araraquara.sp.gov.br` + qualquer senha entra. Para demonstrar cada perfil,
use os e-mails pré-cadastrados (senha livre):

| E-mail | Perfil |
|---|---|
| `fabricio@araraquara.sp.gov.br` | Admin (padrão) |
| `admin@araraquara.sp.gov.br` | Admin |
| `coordenador@araraquara.sp.gov.br` | Coordenador TI |
| `tecnico@araraquara.sp.gov.br` | Técnico |
| `gestor.saude@araraquara.sp.gov.br` | Gestor de Setor (Saúde) |
| `auditor@araraquara.sp.gov.br` | Auditor (somente leitura) |

Dentro do sistema, use o menu do avatar → **"Visualizar como"** para alternar perfis e ver
a interface se adaptar às permissões.

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
