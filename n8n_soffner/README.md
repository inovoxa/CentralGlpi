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
              Salvar atributos → Atualizar status → Responder cliente
                 (custom_attributes)   (toggle_status)     (messages)
```

O nó **Atualizar status** é o que movimenta o Kanban: ao mudar o status da
conversa, a Fase B do Kanban (mapa `mapped_status`) leva o card ao estágio certo.

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

### 5. Kanban — funil e mapa de status
No Kanban do Inovoxachat, crie um funil (ex.: template **Suporte**) vinculado à
inbox de WhatsApp da Soffner e, em **Configurar**, mapeie os estágios aos status:
- estágio inicial → `open`
- um estágio → `pending` (aguardando atendente)
- estágio final → `resolved`

Assim os cards andam sozinhos conforme o assistente muda o status.

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
