# Deploy gratuito do Claro Vox

Guia prático para colocar o MVP no ar sem custo, distribuindo cada peça na
plataforma onde ela é mais simples de configurar — em vez de forçar tudo
num único provedor.

| Peça | Onde | Plano |
|---|---|---|
| Frontend (Vite/React) | [Vercel](https://vercel.com) | Free |
| CIV (Node/Express + WebSocket) | [Northflank](https://northflank.com) — serviço 1 | Sandbox (free) |
| Orquestrador (Python/FastAPI) | [Northflank](https://northflank.com) — serviço 2 | Sandbox (free) |
| Postgres + pgvector | [Supabase](https://supabase.com) | Free tier |
| Redis (cache de sessão) | [Upstash](https://upstash.com) | Free tier |

O plano Sandbox da Northflank dá 2 serviços grátis sempre ativos (sem
dormir) — CIV e Orquestrador cabem exatamente nessas duas vagas. Postgres e
Redis ficam fora da Northflank porque Supabase já garante a extensão
`pgvector` habilitada e Upstash já entrega Redis com TLS pronto — evita
depender do banco/addon gerenciado da Northflank ter ou não essas
capacidades.

## 1. Banco de dados — Supabase

1. Criar um projeto novo em [supabase.com](https://supabase.com).
2. No SQL Editor do projeto, rodar `civ/schema.sql` inteiro uma vez (ele já
   começa com `CREATE EXTENSION IF NOT EXISTS vector`, que o Supabase
   suporta nativamente).
3. Em **Project Settings → Database**, copiar a *Connection string* no
   modo **Session pooler** (porta 5432) ou **Transaction pooler** (porta
   6543) — funciona com o `pg.Pool` usado no CIV.
4. Guardar essa URL — vai virar `DATABASE_URL` do CIV.

## 2. Redis — Upstash

1. Criar um banco Redis novo em [upstash.com](https://upstash.com) (região
   mais próxima do Northflank escolhido).
2. Copiar a URL no formato `rediss://...` (com `s` — já vem com TLS). O
   `ioredis` usado no CIV detecta TLS sozinho a partir do esquema, não
   precisa de configuração extra.

## 3. CIV — Northflank (serviço 1)

1. Criar um novo serviço apontando para este repositório, com **build
   context = `civ/`** (usa o `civ/Dockerfile` já existente).
2. Variáveis de ambiente (baseadas em `civ/.env.example`):

   ```
   PORT=4001
   DATABASE_URL=<connection string do Supabase>
   DATABASE_SSL=true
   REDIS_URL=<URL rediss:// do Upstash>
   CPF_HASH_SECRET=<gerar um valor aleatório novo, não usar o de exemplo>
   JWT_SECRET=<gerar um valor aleatório novo, não usar o de exemplo>
   ORCHESTRATOR_URL=<URL pública do serviço do Orquestrador, passo 4>
   ```
3. Expor a porta 4001 publicamente e anotar a URL pública gerada — vai
   virar `VITE_CIV_URL` do frontend e `CIV_URL` do Orquestrador.
4. Rodar `npm run seed` uma vez (via shell do serviço, ou localmente
   apontando `DATABASE_URL`/`DATABASE_SSL` para o Supabase) para popular os
   dados de demonstração.

## 4. Orquestrador — Northflank (serviço 2)

1. Criar um segundo serviço no mesmo projeto, **build context =
   `orchestrator/`** (usa `orchestrator/Dockerfile`).
2. Variáveis de ambiente (baseadas em `orchestrator/.env.example`):

   ```
   PORT=4002
   CIV_URL=<URL pública do serviço CIV, passo 3>
   ANTHROPIC_API_KEY=<opcional — sem ela, cai no motor de regras local>
   ```
3. Expor a porta 4002 publicamente — vai virar `VITE_ORCH_URL` do frontend.
4. Voltar no serviço do CIV e preencher `ORCHESTRATOR_URL` com essa URL.

## 5. Frontend — Vercel

1. Importar o repositório na Vercel, **root directory = `frontend/`**.
   Framework preset "Vite" é detectado automaticamente.
2. Variáveis de ambiente (baseadas em `frontend/.env.example`):

   ```
   VITE_CIV_URL=<URL pública do serviço CIV>
   VITE_ORCH_URL=<URL pública do serviço Orquestrador>
   ```
3. Deploy. Toda alteração enviada à branch de produção reimplanta
   automaticamente.

## Checklist final

- [ ] `CREATE EXTENSION vector` confirmada no Supabase (rodar
      `SELECT * FROM pg_extension WHERE extname = 'vector';` no SQL Editor)
- [ ] `civ` e `orchestrator` respondendo em `GET /health`
- [ ] `CPF_HASH_SECRET`/`JWT_SECRET` trocados pelos valores de exemplo
- [ ] `npm run seed` rodado uma vez contra o banco do Supabase
- [ ] Login de demonstração funcionando no frontend publicado
      (`admin@clarovox.com` / `atendente@clarovox.com`, senhas em
      `civ/src/seed.ts`)
