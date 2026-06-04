# 🏛️ PROPOSTA COMERCIAL — Automação Inteligente de TI

**Prefeitura Municipal de Araraquara — LGTI**
**Gerência de Tecnologia da Informação**

---

## 1. VISÃO GERAL

Solução de **Assistente Virtual Inteligente** integrado ao WhatsApp que automatiza 100% do ciclo de gestão de usuários e acessos — da abertura do chamado no GLPI até a execução no Active Directory e Exchange — **sem intervenção humana**.

| Componente | Tecnologia |
|---|---|
| Atendimento | WhatsApp (Chatwoot) + IA (LLM) |
| Chamados | GLPI (API REST v2) |
| Automação | n8n (17 workflows orquestrados) |
| Execução | PowerShell → Active Directory + Exchange |
| Banco de dados | PostgreSQL (logs e auditoria) |

---

## 2. AUTOMAÇÃO 100% — USUÁRIOS E ACESSOS

O módulo de **Usuários e Acessos** é totalmente automatizado de ponta a ponta:

| # | Operação | O que acontece automaticamente |
|---|---|---|
| **1.1** | **Criação de Usuário** | Gera login (iniciais + sobrenome), cria conta no AD com OU/grupos/perfil copiados de um usuário modelo, salva CPF, matrícula, setor e cargo no AD, gera senha provisória |
| **1.2** | **Reset de Senha** | Valida que o usuário está ativo no AD, gera nova senha aleatória segura, força troca no primeiro logon |
| **1.3** | **Reativação de Usuário** | Reabilita conta desativada, reseta senha, limpa grupos antigos, copia perfil/grupos do modelo do setor, move para OU correta |
| **1.4** | **Desativação de Usuário** | Desabilita conta, remove todos os grupos, limpa perfil de rede, registra nº do processo no AD, move para OU Desativados |
| **1.5** | **Acesso à Pasta de Rede** | Localiza a pasta no servidor, aplica ACL de leitura+execução com herança para o usuário solicitado |
| **1.6** | **Transferência de Setor** | Desativa acessos antigos → reativa com perfil/grupos/OU do novo setor → gera novas credenciais → atualiza cargo e setor no AD |
| **1.7** | **Criação de E-mail Institucional** | Busca usuário no AD, conecta ao Exchange, verifica duplicidade, cria mailbox (Small Database), e-mail: usuario@araraquara.sp.gov.br |

**Resultado:** após aprovação do chamado no GLPI, a execução no AD/Exchange é **imediata e automática**, e o solicitante recebe as credenciais diretamente no WhatsApp.

---

## 3. SIMULAÇÃO — FLUXO DO USUÁRIO

> **Cenário:** Maria, secretária da Coordenadoria de Saúde, precisa criar acesso para um novo funcionário.

```
╔══════════════════════════════════════════════════════════════╗
║  📱 WHATSAPP DO SOLICITANTE                                 ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Maria: Oi                                                   ║
║                                                              ║
║  🤖 Bot: Olá! Sou o assistente virtual da LGTI 👋            ║
║  Posso ajudá-lo com:                                         ║
║                                                              ║
║  1️⃣ Usuários e Acessos                                       ║
║     1.1 Criação de usuário                                   ║
║     1.2 Reset de senha                                       ║
║     1.3 Reativação de usuário                                ║
║     1.4 Desativação de usuário                               ║
║     1.5 Acesso à pasta de rede                               ║
║     1.6 Transferência de setor ou local                      ║
║     1.7 Criação de e-mail institucional                      ║
║  2️⃣ Suporte de Informática                                   ║
║  3️⃣ Sistemas da Saúde                                        ║
║  4️⃣ Telefonia                                                ║
║                                                              ║
║  Maria: 1.1                                                  ║
║                                                              ║
║  🤖 Bot: Certo! Para criar um novo usuário, preciso          ║
║  das seguintes informações:                                  ║
║  • Nome completo                                             ║
║  • Data de nascimento                                        ║
║  • CPF, Celular, Matrícula                                   ║
║  • Data de admissão                                          ║
║  • Secretaria, Coordenadoria, Gerência, Unidade              ║
║  • CBO/Cargo                                                 ║
║  • E-mail pessoal                                            ║
║  • E-mail do superior (@araraquara.sp.gov.br)                ║
║  • Perfil de referência (colega da mesma função)             ║
║  • Sistema solicitado                                        ║
║  Vamos começar pelo nome completo?                           ║
║                                                              ║
║  Maria: João Carlos de Souza Lima                            ║
║  [... coleta campo a campo ...]                              ║
║                                                              ║
║  🤖 Bot: Confira os dados antes de abrir o chamado:          ║
║  Nome: João Carlos de Souza Lima                             ║
║  Login gerado: JCSLima                                       ║
║  Perfil referência: MPereira (mesmo setor)                   ║
║  [...]                                                       ║
║  Está tudo certo?                                            ║
║                                                              ║
║  Maria: Sim                                                  ║
║                                                              ║
║  🤖 Bot: ✅ Chamado aberto! Número: *4521*                   ║
║  🔗 https://glpi.inovoxa.com.br/front/ticket.form.php?id=.. ║
║                                                              ║
╠════════════ ⏳ APROVAÇÃO NO GLPI (SUPERIOR) ════════════════╣
║                                                              ║
║  [Superior aprova o chamado no GLPI]                         ║
║                                                              ║
╠═════════ ⚡ EXECUÇÃO AUTOMÁTICA NO AD (SEGUNDOS) ═══════════╣
║                                                              ║
║  ✔ Usuário JCSLima criado no Active Directory                ║
║  ✔ OU copiada do modelo MPereira                             ║
║  ✔ Grupos de segurança replicados                            ║
║  ✔ CPF, matrícula, cargo e setor salvos no AD                ║
║  ✔ Senha provisória gerada                                   ║
║  ✔ Follow-up registrado no chamado GLPI                      ║
║  ✔ Chamado fechado automaticamente                           ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  🤖 Bot: ✅ Chamado #4521 — Executado                        ║
║  Usuário criado com sucesso!                                 ║
║  Login: JCSLima                                              ║
║  Senha provisória: k7m2x9p1                                  ║
║  Domínio: pma.local                                          ║
║  A senha deve ser alterada no primeiro acesso.               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

**Tempo total:** de minutos (atendimento) a segundos (execução AD) — contra **horas ou dias** no processo manual.

---

## 4. COBERTURA COMPLETA

Além de Usuários e Acessos, a solução contempla:

| Módulo | Itens | Automação |
|---|---|---|
| Suporte de Informática | 11 subtipos (impressora, software, rede…) | Abertura + categorização automática |
| Sistemas da Saúde | 3 subtipos | Roteamento automático para equipe de Saúde |
| Telefonia | 3 subtipos | Abertura + categorização automática |
| Consulta/Atualização | Por ID ou e-mail | Consulta e follow-up via WhatsApp |

---

## 5. SEGURANÇA

| Controle | Implementação |
|---|---|
| **Credenciais isoladas** | Tokens GLPI, SSH e API nunca expostos ao usuário ou à IA |
| **Validação de e-mail** | E-mail do superior obrigatoriamente `@araraquara.sp.gov.br` |
| **Aprovação obrigatória** | Nenhuma execução no AD ocorre sem aprovação prévia no GLPI |
| **Auditoria completa** | Cada operação logada em `chamados_log` (PostgreSQL) com timestamp |
| **Senhas seguras** | Geradas aleatoriamente (8 caracteres alfanuméricos), troca forçada no primeiro acesso |
| **Anti-duplicidade** | Verificação de login existente no AD antes da criação; verificação de mailbox antes da criação de e-mail |
| **AD protegido** | Execução via SSH com chave privada; script com `ValidateSet` restrito a ações conhecidas |
| **Sem dados sensíveis na IA** | O agente nunca recebe senhas geradas nem tokens de sessão |

---

## 6. ARQUITETURA RESUMIDA

```
  📱 WhatsApp
       │
       ▼
  🔄 Chatwoot ──► 🤖 Agente IA (n8n + LLM)
                        │
            ┌───────────┼───────────┐
            ▼           ▼           ▼
      📋 GLPI API   🗄️ PostgreSQL  📨 WhatsApp
      (Chamados)     (Logs)        (Resultado)
            │
            ▼  (após aprovação)
      ⚡ Workflow 14 ──► SSH ──► PowerShell
                                    │
                          ┌─────────┼─────────┐
                          ▼         ▼         ▼
                    🖥️ Active   📧 Exchange  📂 File
                     Directory   Server      Server
```

---

## 7. BENEFÍCIOS

- **Atendimento 24/7** — disponível fora do horário comercial
- **Zero retrabalho** — dados coletados uma vez, executados sem redigitação
- **Rastreabilidade total** — cada ação registrada no GLPI e no banco de logs
- **Padronização** — todos os usuários criados seguindo o perfil de referência
- **Escalabilidade** — novos serviços adicionados apenas criando novo workflow
- **Redução de tempo** — de dias para minutos no ciclo completo

---

> *Documento gerado em Abril/2026*
> *LGTI — Gerência de Tecnologia da Informação*
> *Prefeitura Municipal de Araraquara*
