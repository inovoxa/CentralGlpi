# Soffner — Atendimento WhatsApp (n8n + Inovoxachat)

Assistente de IA para a **Soffner** (locação de equipamentos de tecnologia:
impressoras, notebooks, desktops, etc.). Atende no WhatsApp pelos dois fluxos —
**suporte** técnico de equipamentos locados e **comercial** (novas locações,
orçamentos, renovações) — passando pelo Inovoxachat (Chatwoot) com o Kanban.

O assistente coleta as informações, grava nos **atributos da conversa** e define
o **status**, que move o card no Kanban pelo mapa *status → estágio*.

## Arquitetura

```
WhatsApp → Inovoxachat (Chatwoot) ──webhook(message_created)──► n8n
                                                                  │
                    ┌─────────────────────────────────────────────┘
                    ▼
   Webhook → Normalizar → É cliente? → Assistente Soffner (OpenRouter/DeepSeek)
                                              │
                                        Parse IA (JSON)
                                              │
                                      Salvar atributos
                                              │
                                       Tipo definido? ──não──┐
                                              │ sim          │
                                       Aplicar etiqueta      │
                                       (suporte/comercial)   │
                                              ▼              ▼
                                        Atualizar status → Responder cliente
                                        (toggle_status)      (messages)
```

**Dois movimentos, dois mecanismos (caminho A — etiqueta + automação):**

1. **Roteamento entre funis** (Suporte vs Comercial): assim que o assistente
   identifica o `tipo_atendimento`, o nó **Aplicar etiqueta** coloca a etiqueta
   `suporte` ou `comercial` na conversa. Uma **regra de automação** (ação
   "Mover para estágio do funil") leva o card ao estágio inicial do funil certo.
2. **Avanço dentro do funil**: o nó **Atualizar status** muda o status da
   conversa e a Fase B do Kanban (mapa `mapped_status`) move o card entre as
   colunas daquele funil.

Assim o assistente lida com **múltiplos funis por cliente**: a etiqueta escolhe o
funil, o status escolhe a coluna.

## Dados coletados (gravados em custom_attributes da conversa)

`nome`, `empresa`, `cnpj`, `tipo_atendimento` (suporte/comercial), `equipamento`,
`serie_patrimonio`, `urgencia` (baixa/média/alta), `descricao`, `contato_retorno`.

## Status usados pelo assistente

| Status    | Quando | Estágio sugerido no Kanban |
|-----------|--------|----------------------------|
| `open`    | ainda coletando informações | Novo / Em Atendimento |
| `pending` | coleta concluída, aguardando humano | Aguardando atendente |
| `resolved`| dúvida simples já resolvida pela IA | Resolvido |

## Setup

### 1. n8n — variáveis de ambiente
Defina no n8n (Settings → Variables ou env do container):

- `CHATWOOT_URL` = `https://chat.inovoxa.com.br`
- `CHATWOOT_TOKEN` = *api_access_token* de um agente/bot da conta (Perfil →
  Access Token no Inovoxachat)

### 2. n8n — credencial
- Conecte a credencial **OpenRouter** no nó `OpenRouter DeepSeek`
  (o mesmo padrão dos outros workflows: `OpenRouter account GLPI`).
- Importe `Soffner_Atendimento_WhatsApp.json` e ative o workflow.

### 3. Inovoxachat (Chatwoot) — webhook
Em **Configurações → Integrações → Webhooks**, crie um webhook apontando para a
URL do nó Webhook do n8n (path `soffner-atendimento`), assinando o evento
**Message created**. Ex.: `https://<n8n>/webhook/soffner-atendimento`.

### 4. Inovoxachat — atributos de conversa (opcional, recomendado)
Crie os **Custom Attributes** de conversa com as mesmas chaves acima
(Configurações → Atributos personalizados → Conversa) para eles aparecerem
formatados na barra lateral da conversa. Sem isso, os valores ainda são
gravados, mas exibidos como chave/valor cru.

### 5. Kanban — funis e mapa de status
Crie os funis (ex.: **Funil Suporte** e **Funil Comercial**), ambos vinculados à
inbox de WhatsApp da Soffner. Em cada um, **Configurar → mapeie os estágios aos
status**:
- estágio inicial → `open`
- um estágio → `pending` (aguardando atendente)
- estágio final → `resolved`

Assim os cards avançam sozinhos dentro do funil conforme o assistente muda o status.

### 6. Automação — roteamento por etiqueta (caminho A)
Crie as etiquetas `suporte` e `comercial` (Configurações → Etiquetas) e duas
**regras de automação** (Configurações → Automação), evento *Conversa atualizada*:

| Condição | Ação |
|---|---|
| Etiqueta contém `comercial` | Mover para estágio do funil → estágio inicial do **Funil Comercial** |
| Etiqueta contém `suporte`   | Mover para estágio do funil → estágio inicial do **Funil Suporte** |

O assistente aplica a etiqueta; a automação leva o card ao funil certo. Depois de
roteado, o status (Fase B) cuida do avanço dentro daquele funil.

## Observações

- O assistente responde **sempre em JSON** (resposta + status + atributos); o nó
  **Parse IA** extrai o JSON e segue o fluxo. Se o modelo devolver texto solto, o
  fluxo degrada enviando o texto como resposta e mantém `status=open`.
- O `message_type=incoming` no nó **É cliente?** evita que o bot responda às
  próprias mensagens (loop).
- Modelo padrão: `deepseek/deepseek-chat` via OpenRouter — troque em
  `OpenRouter DeepSeek` se quiser outro.
- Este workflow é um **ponto de partida** por cliente; ajuste o system prompt do
  nó `Assistente Soffner` conforme o catálogo e o tom da Soffner.
