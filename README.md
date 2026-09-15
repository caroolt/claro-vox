# Claro Vox — MVP (Sprint 3)

Implementação funcional (back-end + front-end) da camada de identidade
conversacional **Claro Vox**, descrita na documentação técnica da Sprint 2.
Este README cobre como rodar o projeto localmente e traz um roteiro sugerido
para a gravação do vídeo de demonstração da Sprint 3.

## Arquitetura (resumo)

```
┌──────────────┐      HTTP       ┌────────────────────┐      HTTP        ┌──────────────────────┐
│  Frontend     │ ─────────────▶ │  Orquestrador        │ ───────────────▶ │  CIV                  │
│  (React/Vite) │ ◀───────────── │  (Python/FastAPI)     │ ◀───────────────│  (Node.js/Express)    │
└──────────────┘                 │  - NLU / intenção      │                 │  - Identidade do cliente│
       │                          │  - RAG (embeddings)    │                 │  - Contexto persistente │
       │  WebSocket (tempo real)  │  - Decisão de transbordo│                 │  - Estado da sessão     │
       └─────────────────────────▶└────────────────────┘                 └──────────┬────────────┘
                                                                                        │
                                                                     ┌──────────────────┼──────────────────┐
                                                                     ▼                  ▼                  ▼
                                                               PostgreSQL          Redis (cache        WebSocket
                                                               + pgvector          de sessão ativa)     /ws/briefing
```

- **CIV (Camada de Identidade Vox)** — Node.js + TypeScript + Express. Dona
  exclusiva do Postgres. Implementa Cold Start (RF010/011), reconhecimento
  cross-canal (RF004), contexto persistente (RF001), fila de transbordo
  (RF007-009), base de conhecimento (RAG) e o direito de exclusão da LGPD
  (art. 18).
- **Orquestrador** — Python + FastAPI. Não acessa o Postgres diretamente;
  fala apenas com a CIV. Classifica intenção e tom emocional (motor de
  regras local, com fallback opcional para Claude Haiku 4.5 via API caso
  uma chave seja configurada), faz a recuperação por similaridade (RAG)
  sobre a base de conhecimento, gera a resposta do Vox e decide quando
  acionar o transbordo.
- **Frontend** — React + Vite + TypeScript + Tailwind. Duas visões: o
  **Simulador de Cliente** (chat multicanal — WhatsApp, Site, App, Central
  de Voz) e o **Painel do Atendente / Vox Briefing** (fila de transbordo,
  sessões ativas, métricas, base de conhecimento), atualizado em tempo
  real via WebSocket.

## Simplificações assumidas no MVP (documentadas)

Para rodar 100% localmente e sem custos de API neste sprint, duas peças da
arquitetura de produção foram substituídas por versões locais equivalentes,
com o mesmo contrato de dados:

1. **Embeddings**: em vez de um provedor de embeddings pago, usamos um
   hashing trick (FNV-1a, 64 dimensões, normalização L2) implementado de
   forma **idêntica** em TypeScript (`civ/src/embedding.ts`) e Python
   (`orchestrator/embedding.py`) — validado bit-a-bit nos testes. O RAG usa
   um re-ranqueamento léxico sobre os candidatos retornados pela busca
   vetorial (`orchestrator/rag.py`) para compensar a menor precisão
   semântica de um embedding tão simples.
2. **LLM**: o Orquestrador tenta usar o Claude Haiku 4.5 de verdade
   (`orchestrator/llm.py`) se `ANTHROPIC_API_KEY` estiver definida; sem a
   chave, cai automaticamente em um motor de classificação por regras +
   respostas por template (`orchestrator/nlu.py`) que cobre os mesmos
   cenários documentados na Seção 5.7.

Ambas as trocas são citadas nos comentários do código-fonte e devem ser
mencionadas no vídeo (ver roteiro abaixo) — é exatamente o tipo de decisão
de engenharia que se espera justificar em uma arguição.

## Como rodar localmente

### Opção A — Docker Compose (recomendado)

```bash
cd claro-vox-app
docker compose up --build
```

Serviços disponíveis:
- Frontend: http://localhost:5173
- Orquestrador: http://localhost:4002/health
- CIV: http://localhost:4001/health

Depois do primeiro `up`, rode o seed de dados de demonstração uma vez:

```bash
docker compose exec civ node dist/seed.js
```

### Opção B — Manual (sem Docker)

Pré-requisitos: Node.js 20+, Python 3.11+, PostgreSQL 16 com a extensão
`pgvector`, Redis.

```bash
# 1) banco de dados
createuser clarovox --pwprompt   # senha: clarovox_dev_pw (ou ajuste o .env)
createdb claro_vox -O clarovox
psql -d claro_vox -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -d claro_vox -f civ/schema.sql

# 2) CIV
cd civ
cp .env.example .env
npm install
npx ts-node-dev --transpile-only src/index.ts &
npx ts-node --transpile-only src/seed.ts   # popula dados de demonstração

# 3) Orquestrador
cd ../orchestrator
cp .env.example .env
pip install -r requirements.txt
python3 -m uvicorn main:app --port 4002 &

# 4) Frontend
cd ../frontend
cp .env.example .env
npm install
npm run dev
```

Abra http://localhost:5173.

### Cliente de demonstração já cadastrado pelo seed

- Nome: Carlos · CPF de teste: `111.222.333-96` · tipo: cliente ativo

Use esse CPF para demonstrar o **reconhecimento cross-canal (RF004)** sem
precisar refazer o Cold Start.

## Autenticação e RBAC do Painel do Atendente (Vox Briefing)

Só o **Painel do Atendente / Vox Briefing** exige login — o Simulador de
Cliente continua 100% aberto (é o que representa o cliente final falando
com o Vox). O login tem duas etapas:

1. **E-mail + senha.**
2. **Código de 6 dígitos (MFA/2FA, TOTP — RFC 6238).** No primeiro acesso de
   cada conta, o painel mostra um QR code (gerado localmente pela CIV, o
   segredo nunca sai do servidor) para configurar um app autenticador
   (Google Authenticator, Authy, 1Password, etc.); nos logins seguintes só
   pede o código.

Duas roles (RBAC), aplicado tanto no back-end (CIV) quanto nas abas do
front-end:

| Role | Abas visíveis |
|---|---|
| **Admin** | Visão geral, Operação, Clientes, Conhecimento (RAG) + **Atendentes** (CRUD dos usuários do painel) |
| **Atendente** | Operação, Clientes, Conhecimento (RAG) |

### Usuários de demonstração (criados pelo seed)

| E-mail | Senha | Role |
|---|---|---|
| `admin@clarovox.com` | `ClaroVox@Admin1` | admin |
| `atendente@clarovox.com` | `ClaroVox@Atendente1` | atendente |

Nenhum dos dois tem o MFA configurado, no primeiro login de cada um,
escaneie o QR exibido na tela com um app autenticador e digite o código
gerado para concluir a configuração.

**Aviso de MVP:** como nas demais simplificações documentadas acima, essas
credenciais/segredos existem só para rodar o projeto localmente.

## Estrutura do repositório

```
claro-vox-app/
├── civ/                 # Node.js + TypeScript + Express (Camada de Identidade Vox)
│   ├── src/
│   ├── schema.sql
│   └── Dockerfile
├── orchestrator/         # Python + FastAPI (Orquestrador)
│   ├── main.py, nlu.py, rag.py, llm.py, embedding.py
│   └── Dockerfile
├── frontend/             # React + Vite + TypeScript + Tailwind
│   ├── src/
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## Requisitos funcionais implementados nesta Sprint

| RF | Descrição | Onde |
|---|---|---|
| RF001 | Contexto persistente entre interações | `civ/src/routes/sessions.ts`, tabela `contexto` |
| RF002 | Classificação de intenção e tom emocional | `orchestrator/nlu.py` / `llm.py` |
| RF004 | Reconhecimento e handoff sem fricção entre canais | `civ/src/routes/coldstart.ts` (`/reconhecer`) |
| RF007 | Detecção de necessidade de transbordo | `orchestrator/main.py` + `orchestrator/nlu.py` |
| RF008 | Geração de briefing para o atendente humano | `civ/src/routes/handoff.ts` |
| RF009 | Fila e painel de atendimento humano em tempo real | `frontend/src/components/AgentPanel.tsx` + `civ/src/ws.ts` |
| RF010 | Cold Start conversacional | `civ/src/routes/coldstart.ts` (`/start`, `/answer`) |
| RF011 | Segmentação cliente ativo vs. prospecção | `civ/src/routes/coldstart.ts` |
| RNF (LGPD art. 18) | Direito de exclusão | `civ/src/routes/clientes.ts` |
| RNF (segurança do CPF) | Pseudonimização via HMAC-SHA-256 | `civ/src/crypto.ts` |
| RNF (autenticação do painel) | Login + MFA (TOTP) e RBAC (admin/atendente) no Vox Briefing | `civ/src/auth.ts`, `civ/src/middleware/auth.ts`, `civ/src/routes/auth.ts`, `civ/src/routes/usuarios.ts` |
| RNF (protocolo de atendimento) | Cada sessão/chamada ganha um protocolo único, informado ao cliente logo após o Cold Start | `civ/src/helpers.ts` (`gerarProtocolo`), `civ/src/routes/coldstart.ts` |
| RF (contratação simulada de plano) | Fluxo guiado no chat (pré-pago/controle/pós) que confirma nome+nascimento+CPF (cliente já cadastrado) ou coleta os mesmos dados (cliente novo) antes de confirmar | `orchestrator/contratacao.py`, `civ/src/routes/contratos.ts` |

### Protocolo de atendimento

Assim que o Cold Start termina (sessão vira `ATIVA`) — ou quando o cliente é
reconhecido ao trocar de canal (RF004) — o Vox gera e informa um
**protocolo** (`VX-AAAAMMDD-XXXX`) logo na mensagem de boas-vindas. Cada
sessão/chamada tem o seu próprio protocolo, independente do canal, e ele
aparece também no Painel do Atendente (fila de transbordo, sessões ativas,
briefing e histórico do cliente).

### Contratação simulada de plano

Quando o cliente demonstra intenção de compra no chat (ex.: "quero
contratar um plano", "quero ativar uma linha"), o Vox entra num fluxo
guiado, uma pergunta por vez: tipo de plano (Pré-pago/Controle/Pós-pago),
nome completo, data de nascimento e CPF.

- **Cliente já cadastrado**: os dados digitados precisam **conferir** com o
  cadastro existente (nome e CPF) — se não conferirem, a contratação é
  recusada e a sessão vai para transbordo (verificação de identidade por um
  atendente humano), em vez de simplesmente seguir em frente.
- **Cliente novo (prospecção)**: os mesmos dados completam o cadastro e o
  promovem para cliente ativo (KYC simplificado do MVP).

Ao final, o Vox confirma a contratação e devolve o protocolo da própria
sessão como identificador da solicitação.
