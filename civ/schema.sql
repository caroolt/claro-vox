-- Claro Vox — CIV (Camada de Identidade Vox) — schema
-- Espelha o modelo de dados da Seção 4.4 da Documentação Técnica Sprint 2.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS canal (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL UNIQUE,
  tipo_adapter  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cliente (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cpf_hash       TEXT UNIQUE,          -- HMAC-SHA-256(CPF) — nunca guardamos o CPF em texto puro (Seção 4.6)
  telefone       TEXT,                 -- usado para base de prospecção (RF011) quando não há CPF ainda
  nome           TEXT NOT NULL,
  tipo_cliente   TEXT NOT NULL CHECK (tipo_cliente IN ('ativo','prospeccao')),
  consentimento_ts TIMESTAMPTZ,
  consentimento_versao TEXT,
  data_cadastro  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS preferencia_acessibilidade (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id              UUID NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
  modalidade_libras       BOOLEAN NOT NULL DEFAULT false,
  leitor_de_tela          BOOLEAN NOT NULL DEFAULT false,
  linguagem_simplificada  BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS sessao (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id       UUID REFERENCES cliente(id) ON DELETE SET NULL,
  canal_origem_id  UUID REFERENCES canal(id),
  estado           TEXT NOT NULL DEFAULT 'INEXISTENTE'
                     CHECK (estado IN ('INEXISTENTE','COLD_START','ATIVA','TRANSBORDO_PENDENTE','EM_ATENDIMENTO_HUMANO','ENCERRADA')),
  cold_start_etapa TEXT,               -- controla em qual pergunta do Cold Start a sessão está
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contexto (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_id          UUID NOT NULL UNIQUE REFERENCES sessao(id) ON DELETE CASCADE,
  historico_resumido TEXT,
  ultima_intencao    JSONB,
  jornada_status     TEXT NOT NULL DEFAULT 'EM_ANDAMENTO',
  canal_atual        TEXT,
  canal_anterior     TEXT,
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mensagem (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_id   UUID NOT NULL REFERENCES sessao(id) ON DELETE CASCADE,
  canal_id    UUID REFERENCES canal(id),
  remetente   TEXT NOT NULL CHECK (remetente IN ('cliente','vox','atendente')),
  conteudo    TEXT NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intencao (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mensagem_id   UUID NOT NULL REFERENCES mensagem(id) ON DELETE CASCADE,
  categoria     TEXT NOT NULL,
  subcategoria  TEXT,
  confianca     REAL,
  tom_emocional TEXT
);

CREATE TABLE IF NOT EXISTS briefing (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_id          UUID NOT NULL REFERENCES sessao(id) ON DELETE CASCADE,
  resumo_jornada     TEXT,
  canais_utilizados  TEXT,
  tom_emocional      TEXT,
  motivo_transbordo  TEXT,
  sugestao_resolucao TEXT,
  gerado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS handoff (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id   UUID NOT NULL REFERENCES briefing(id) ON DELETE CASCADE,
  atendente_id  TEXT,
  canal_origem  TEXT,
  assumido_em   TIMESTAMPTZ,
  encerrado_em  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS auditoria (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ator        TEXT NOT NULL,       -- serviço/usuário que acessou
  acao        TEXT NOT NULL,       -- leitura/escrita + recurso
  recurso_id  TEXT,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Base de conhecimento (RAG) consultada pelo Orquestrador via pgvector.
-- Embeddings simplificados (hashing TF-IDF, 64 dimensões) para o MVP local —
-- ver nota técnica no README sobre a diferença para embeddings de produção.
CREATE TABLE IF NOT EXISTS knowledge_base (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo     TEXT NOT NULL,
  conteudo   TEXT NOT NULL,
  categoria  TEXT,
  embedding  vector(64)
);

CREATE INDEX IF NOT EXISTS idx_sessao_estado ON sessao(estado);
CREATE INDEX IF NOT EXISTS idx_mensagem_sessao ON mensagem(sessao_id);
CREATE INDEX IF NOT EXISTS idx_cliente_cpf_hash ON cliente(cpf_hash);
