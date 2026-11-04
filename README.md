# Motor de IA de Atendimento

Motor de atendimento automatizado com IA, desenvolvido como teste técnico para um CRM multi-tenant. A aplicação recebe mensagens por HTTP, agrupa mensagens enviadas em sequência, mantém uma ficha estruturada do lead, executa ações no CRM e permite intervenção humana.

## 1. Tecnologias

- **Node.js + TypeScript**
- **NestJS 11** — framework da API e organização modular.
- **PostgreSQL 16** — persistência dos dados.
- **Prisma ORM 7** — acesso ao banco e migrations.
- **Redis 7 + BullMQ 6** — processamento assíncrono e janela antirrajada.
- **Google Gemini** — provedor de LLM.
- **Jest** — testes automatizados.
- **Docker Compose** — ambiente de execução.

## 2. Como executar

### Pré-requisitos

- Docker Desktop com Docker Compose.
- Git.

### Configuração

Clone o repositório e entre na pasta:

```bash
git clone <URL_DO_REPOSITORIO>
cd motor-ia-atendimento
```

Crie o arquivo `.env` a partir do exemplo:

```bash
cp .env.example .env
```

No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

A configuração padrão utiliza `LLM_PROVIDER=mock`, permitindo executar o projeto sem chave de API externa.

### Subir a aplicação

```bash
docker compose up --build -d
```

O Docker Compose inicia:

- PostgreSQL;
- Redis;
- API NestJS.

Na inicialização, o container da API executa a geração do Prisma Client, aplica as migrations e inicia a aplicação.

### Popular os dados iniciais

Após os containers iniciarem:

```bash
docker compose exec api npx prisma db seed
```

O seed cadastra dois tenants de demonstração:

- `sol-nascente` — Sol Nascente Energia Solar;
- `ecovolt-sul` — EcoVolt Engenharia Solar.

Também cadastra horários disponíveis para a agenda simulada.

### Verificar funcionamento

```bash
curl http://localhost:3000/health
```

A resposta esperada contém:

```json
{
  "status": "ok"
}
```

A API fica disponível em `http://localhost:3000`.

### Executar testes

```bash
docker compose exec api npm test -- --runInBand
```

## 3. Arquitetura

A aplicação utiliza uma arquitetura modular baseada no NestJS, separando entrada HTTP, regras de negócio, persistência, processamento assíncrono e integração com LLM.

```text
                 CLIENTE / CRM
                       |
                       v
              POST /webhook/mensagem
                       |
                       v
                WebhookService
                       |
             +---------+---------+
             |                   |
             v                   v
         PostgreSQL          Redis/BullMQ
       Mensagem PENDING      Debounce de 8s
                                 |
                                 v
                         ConversationProcessor
                                 |
                    +------------+------------+
                    |                         |
                    v                         v
             PromptBuilderService         LlmProvider
                                              |
                                     +--------+--------+
                                     |                 |
                                     v                 v
                                GeminiAdapter     MockLlmAdapter
                                     |
                                     v
                              ToolExecutorService
                                     |
                       +-------------+-------------+
                       |             |             |
                       v             v             v
                   Qualificação   Agenda       Auditoria
                       |             |             |
                       +-------------+-------------+
                                     |
                                     v
                                  Prisma
                                     |
                                     v
                                PostgreSQL
```

### Principais módulos

| Módulo | Responsabilidade |
|---|---|
| Webhook | Receber mensagens, validar dados e controlar idempotência |
| Queue | Agendar e controlar o processamento assíncrono |
| Conversations | Consultar conversas e seus estados |
| Intervention | Assumir ou religar o atendimento humano |
| Qualification | Aplicar as regras determinísticas de qualificação |
| Tool Executor | Validar, executar e auditar ferramentas |
| LLM | Abstrair o provedor de inteligência artificial |
| Prisma | Persistir dados e executar operações no PostgreSQL |

## 4. Decisões técnicas

### PostgreSQL como fonte principal dos dados

O PostgreSQL armazena:

- Tenants e suas configurações;
- Conversas e estados;
- Mensagens;
- Fichas dos leads;
- Horários da agenda;
- Auditoria das ferramentas;
- Etapas e métricas dos turnos.

A idempotência é garantida por uma restrição de unicidade envolvendo `tenant_id` e `external_message_id`. Assim, o recebimento repetido de uma mensagem não deve gerar um novo processamento.

### Redis e BullMQ para a janela antirrajada

Foi escolhida uma janela de 8 segundos para agrupar mensagens enviadas em sequência.

O fluxo funciona assim:

1. A mensagem é persistida imediatamente no PostgreSQL.
2. Um job com atraso de 8 segundos é agendado no BullMQ.
3. Se outra mensagem chegar durante a janela, o processamento é reagendado.
4. Após o período sem novas mensagens, o worker busca as mensagens pendentes no PostgreSQL.
5. O conteúdo é consolidado e enviado ao processamento do LLM.

Essa abordagem evita depender de temporizadores em memória, que poderiam ser perdidos em reinicializações da aplicação.

O processamento também utiliza controle de concorrência, lock no Redis e controle otimista de versão da conversa.

### Abstração do provedor de LLM

Foi criado o contrato `LlmProvider`, permitindo trocar o provedor sem reescrever o processamento principal.

Implementações disponíveis:

- `GeminiAdapter`: integração com o Google Gemini.
- `MockLlmAdapter`: respostas determinísticas para desenvolvimento e testes.

A seleção é feita pela variável `LLM_PROVIDER`.

### Prompt e prevenção de alucinações

O `PromptBuilderService` monta o contexto de cada turno utilizando:

- Configuração do tenant;
- Dados persistidos na ficha do lead;
- Histórico da conversa;
- Regras de atendimento;
- Instruções para uso das ferramentas.

O prompt orienta o modelo a não inventar informações, não prometer preços ou economia sem fundamento e consultar a agenda antes de responder sobre disponibilidade.

Entretanto, o prompt não é tratado como mecanismo de segurança suficiente. As regras críticas são reforçadas no backend:

- A qualificação é determinística;
- As ferramentas validam seus argumentos;
- Os dados da ficha são persistidos pelo backend;
- As ações são registradas em auditoria;
- O modo de simulação impede efeitos reais;
- A intervenção humana bloqueia novas respostas da IA enquanto estiver ativa.

Isso reduz o risco de respostas ou ações indevidas, mas não representa uma garantia absoluta contra alucinações.

### Ferramentas implementadas

| Ferramenta | Finalidade |
|---|---|
| `atualizar_ficha` | Atualizar dados do lead |
| `adicionar_tag` | Adicionar tags à conversa |
| `mover_estagio` | Atualizar o estágio do funil |
| `notificar_equipe` | Registrar uma notificação |
| `transferir_humano` | Encaminhar o atendimento |
| `consultar_agenda` | Consultar horários disponíveis |
| `marcar_agenda` | Reservar um horário |

As execuções são registradas na persistência de ferramentas e na auditoria.

## 5. Configuração do LLM

Por padrão, o projeto utiliza o Mock:

```env
LLM_PROVIDER=mock
```

Para utilizar o Gemini, configure:

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=sua_chave
GEMINI_MODEL=gemini-3.8-flash
LLM_TIMEOUT_MS=30000
```

A chave deve ser mantida exclusivamente no `.env`, que não deve ser versionado.

A integração com o Gemini está implementada, mas sua validação real ficou limitada por respostas `503 UNAVAILABLE` recebidas durante as tentativas de execução. Os testes automatizados utilizam o Mock e não dependem da API externa.

## 6. Custo estimado por conversa

O custo depende principalmente do volume de tokens de entrada e saída, incluindo as chamadas adicionais necessárias para executar ferramentas.

Como referência, a documentação oficial do Gemini 3.8 Flash informa preços promocionais até 31/12/2026 de:

- Entrada: US$ 0,75 por milhão de tokens.
- Saída: US$ 3,75 por milhão de tokens.

A partir de 01/01/2027, os preços informados passam para US$ 1,50 e US$ 7,50, respectivamente.

Fonte: [Google Gemini API — Pricing](https://ai.google.dev/gemini-api/docs/pricing).

### Exemplo ilustrativo

Considerando uma conversa que consuma, somando todas as chamadas ao modelo:

- 10.000 tokens de entrada;
- 2.000 tokens de saída.

O custo estimado seria:

```text
Entrada:  10.000 / 1.000.000 × US$ 0,75 = US$ 0,0075
Saída:     2.000 / 1.000.000 × US$ 3,75 = US$ 0,0075

Total estimado: US$ 0,015 por conversa
```

Esse valor é apenas uma simulação de consumo, não uma medição real do projeto. O consumo efetivo depende do histórico enviado, do tamanho do prompt e da quantidade de chamadas de ferramentas.

O projeto foi validado principalmente com o Mock, portanto não há uma média real de custo por conversa medida com o Gemini. O exemplo também não inclui infraestrutura, impostos ou conversão cambial.

### Como reduzir custos

- Resumir históricos longos em vez de reenviar todo o conteúdo.
- Reduzir o tamanho do prompt.
- Evitar chamadas desnecessárias ao LLM.
- Utilizar regras determinísticas para decisões de negócio.
- Escolher modelos mais econômicos quando adequados.
- Monitorar tokens de entrada e saída por turno.

## 7. Testes e resultados

Os testes automatizados foram executados com:

```bash
docker compose exec api npm test -- --runInBand
```

**Resultado:** suíte completa aprovada na última execução realizada durante o desenvolvimento.

Também foram feitas validações manuais dos seguintes fluxos:

| Cenário | Resultado observado |
|---|---|
| Recebimento e persistência de mensagens | Validado |
| Idempotência por `message_id` | Validada |
| Agrupamento de três mensagens na janela | Validado |
| Extração e persistência da ficha | Validada |
| Qualificação de lead | Validada |
| Desqualificação de lead | Validada |
| Intervenção humana (`assumir`) | Validada |
| Religamento da IA (`religar`) | Validado |
| Bloqueio da IA durante atendimento humano | Validado |
| Execução de `consultar_agenda` | Validada no banco |

### Limitação da avaliação

O planejamento previa um script `scripts/evaluate-scenarios.ts`, com cinco cenários automatizados e relatório `PASS/FAIL`.

Esse script não foi implementado nesta entrega. Portanto, não existe um relatório de avaliação dos cinco cenários da PRD.

Os resultados apresentados acima correspondem aos testes automatizados e às validações manuais efetivamente executadas. Não devem ser interpretados como aprovação integral dos cinco cenários de avaliação.

## 8. Limitações conhecidas

- O `MockLlmAdapter` possui comportamento determinístico e não representa toda a capacidade de um LLM real.
- A integração real com o Gemini não foi validada ponta a ponta devido a respostas `503 UNAVAILABLE`.
- A consulta de agenda foi executada e retornou horários, mas o Mock ainda não utiliza esses horários de forma completa na resposta textual ao lead.
- O fluxo completo de escolha e confirmação de agendamento não foi validado ponta a ponta nesta entrega.
- A notificação externa não possui integração real com um serviço de mensagens; sua execução é simulada/registrada pelo backend.
- O script de avaliação dos cinco cenários não foi implementado.
- Não foi disponibilizado o endpoint de métricas consolidadas por tenant previsto no escopo original.
- O ambiente Docker está configurado para desenvolvimento, não para produção.

## 9. Próximos passos para produção — 100 empresas

Para evoluir a solução para atender aproximadamente 100 empresas, os seguintes pontos seriam prioritários:

1. **Isolamento multi-tenant:** revisar todas as consultas e operações para garantir isolamento rigoroso por `tenant_id`, incluindo testes automatizados de segurança.
2. **Escalabilidade:** separar API e workers em processos independentes, permitindo escalar cada componente conforme a demanda.
3. **Infraestrutura:** utilizar PostgreSQL e Redis gerenciados, com backup, monitoramento, alta disponibilidade e estratégia de recuperação.
4. **Filas:** dimensionar concorrência, retentativas, filas de falha e limites por tenant.
5. **Segurança:** implementar autenticação, autorização, validação de assinatura dos webhooks, rate limiting e gerenciamento seguro de credenciais.
6. **Observabilidade:** disponibilizar métricas por tenant, latência, custos, erros, taxa de qualificação e transferências humanas.
7. **Integrações reais:** integrar WhatsApp, CRM, agenda e serviço de notificação.
8. **Avaliação contínua:** implementar os cinco cenários da PRD, testes de regressão e avaliação de qualidade das respostas do LLM.
9. **Controle de custos:** estabelecer limites por empresa, monitoramento de tokens e políticas de uso dos modelos.
10. **Operação:** criar pipeline de CI/CD, ambientes separados de homologação e produção, logs estruturados e alertas.

## 10. Endpoints disponíveis

### Health check

```http
GET /health
```

### Receber mensagem

```http
POST /webhook/mensagem
Content-Type: application/json
```

Exemplo:

```json
{
  "tenant_id": "sol-nascente",
  "telefone": "81999990000",
  "message_id": "mensagem-001",
  "texto": "Olá, gostaria de saber sobre energia solar.",
  "simulacao": false
}
```

Para mensagens enviadas por um atendente humano:

```json
{
  "tenant_id": "sol-nascente",
  "telefone": "81999990000",
  "message_id": "mensagem-humano-001",
  "texto": "Olá, vou continuar seu atendimento.",
  "autor": "humano",
  "simulacao": false
}
```

### Consultar conversa

```http
GET /conversas/:tenant_id/:telefone
```

Exemplo:

```http
GET /conversas/sol-nascente/81999990000
```

### Intervenção humana

```http
POST /intervencao
Content-Type: application/json
```

Assumir atendimento:

```json
{
  "tenant_id": "sol-nascente",
  "telefone": "81999990000",
  "acao": "assumir"
}
```

Religar IA:

```json
{
  "tenant_id": "sol-nascente",
  "telefone": "81999990000",
  "acao": "religar"
}
```

---

## 11. Estrutura do projeto

```text
src/
├── conversations/
├── crm/
├── crm-actions/
├── intervention/
├── llm/
│   ├── adapters/
│   └── interfaces/
├── prisma/
├── qualification/
├── queue/
├── tenants/
├── tool-executor/
└── webhook/

prisma/
├── migrations/
├── schema.prisma
└── seed.ts

test/
```

## Considerações finais

O projeto entrega uma base funcional de um motor de atendimento multi-tenant, com processamento assíncrono, persistência, qualificação determinística, execução de ferramentas, auditoria e intervenção humana.

As limitações restantes estão explicitadas para diferenciar o que foi implementado e validado do que ainda exigiria evolução antes de uma utilização em produção.