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
  data_nascimento DATE,                -- confirmada/coletada no fluxo de contratação de plano
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
  -- Protocolo de atendimento — identifica esta sessão/chamada pro cliente,
  -- independente do canal (uma nova sessão por troca de canal via RF004
  -- também ganha o seu próprio protocolo). Gerado assim que o Cold Start
  -- termina e a sessão vira ATIVA.
  protocolo        TEXT UNIQUE,
  -- Sinais cross-identidade para detecção de fraude (Seção "Camada de
  -- Fraude"): permitem ligar clientes com CPFs DIFERENTES quando usam o
  -- mesmo aparelho ou a mesma origem de rede — CPF sozinho não pega isso,
  -- já que cada CPF só pode pertencer a um `cliente` (ver cliente.cpf_hash).
  -- dispositivo_id é gerado/persistido no navegador do simulador (proxy de
  -- aplicação para o que um identificador de aparelho real daria).
  dispositivo_id   TEXT,
  ip_origem        TEXT,
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
  -- Fluxo conversacional guiado em andamento (ex.: contratação de plano) —
  -- guarda em qual etapa está e os dados já coletados, pra sobreviver entre
  -- mensagens sem precisar de estado em memória no Orquestrador.
  fluxo_ativo        TEXT,
  fluxo_dados        JSONB,
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

-- Pesquisa de NPS — coletada no cliente em dois momentos: (1) da IA, junto
-- da mensagem de transbordo (antes do atendente humano assumir); (2) do
-- atendente humano, quando ele encerra a sessão. Uma resposta por sessão e
-- por alvo (UNIQUE) — reenviar atualiza a nota.
CREATE TABLE IF NOT EXISTS nps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_id    UUID NOT NULL REFERENCES sessao(id) ON DELETE CASCADE,
  alvo         TEXT NOT NULL CHECK (alvo IN ('ia','atendente')),
  nota         SMALLINT NOT NULL CHECK (nota BETWEEN 0 AND 10),
  comentario   TEXT,
  briefing_id  UUID REFERENCES briefing(id) ON DELETE SET NULL,
  atendente_id TEXT,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sessao_id, alvo)
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

-- Contas do Painel do Atendente (Vox Briefing) — login + MFA (TOTP) e RBAC
-- (admin / atendente). O simulador de cliente e as chamadas internas do
-- Orquestrador continuam sem autenticação, ver Seção "Autenticação" do README.
CREATE TABLE IF NOT EXISTS usuario (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  senha_hash   TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('admin','atendente')),
  mfa_secret   TEXT NOT NULL,
  mfa_ativado  BOOLEAN NOT NULL DEFAULT false,
  ativo        BOOLEAN NOT NULL DEFAULT true,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contratação simulada de plano (pré-pago/controle/pós), disparada pelo
-- fluxo guiado do Vox dentro do chat (não é uma tela separada). Reaproveita
-- o protocolo da sessão como identificador da solicitação.
CREATE TABLE IF NOT EXISTS contrato (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id       UUID NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
  sessao_id        UUID NOT NULL REFERENCES sessao(id) ON DELETE CASCADE,
  tipo_plano       TEXT NOT NULL CHECK (tipo_plano IN ('pre-pago','controle','pos-pago')),
  protocolo        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmado' CHECK (status IN ('confirmado','cancelado')),
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Parâmetros operacionais editáveis pelo admin no painel (aba
-- "Configurações") — em vez de constantes fixas no código, para que metas
-- de negócio (meta de transbordo) e limiares de detecção de fraude possam
-- ser ajustados sem deploy. Toda alteração é registrada em `auditoria`.
CREATE TABLE IF NOT EXISTS configuracao (
  chave          TEXT PRIMARY KEY,
  valor          NUMERIC NOT NULL,
  descricao      TEXT,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por UUID REFERENCES usuario(id)
);

-- Alertas do motor de detecção de fraude cross-canal (Seção "Camada de
-- Fraude"). Cada linha carrega não só o veredito, mas a evidência bruta e
-- uma explicação legível (camada de explicabilidade/XAI) — nunca um score
-- opaco. `confianca` reflete a natureza da regra que disparou o alerta:
-- 'alta' para sinais determinísticos (volume por CPF, dispositivo/IP
-- compartilhado), 'baixa'/'media' para sinais probabilísticos (estilo de
-- escrita), que nunca devem bloquear uma contratação sozinhos.
CREATE TABLE IF NOT EXISTS alerta_fraude (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  regra          TEXT NOT NULL CHECK (regra IN ('A_volume_cpf','B_dispositivo_ip','C_estilo_escrita')),
  clientes_ids   UUID[] NOT NULL,
  evidencia      JSONB NOT NULL,
  explicacao     TEXT NOT NULL,
  confianca      TEXT NOT NULL CHECK (confianca IN ('alta','media','baixa')),
  status         TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','revisado','descartado')),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessao_estado ON sessao(estado);
CREATE INDEX IF NOT EXISTS idx_mensagem_sessao ON mensagem(sessao_id);
CREATE INDEX IF NOT EXISTS idx_cliente_cpf_hash ON cliente(cpf_hash);
CREATE INDEX IF NOT EXISTS idx_sessao_dispositivo ON sessao(dispositivo_id);
CREATE INDEX IF NOT EXISTS idx_sessao_ip ON sessao(ip_origem);
CREATE INDEX IF NOT EXISTS idx_alerta_fraude_status ON alerta_fraude(status);

INSERT INTO configuracao (chave, valor, descricao) VALUES
  ('meta_transbordo_pct', 25, 'Meta (%) da taxa de transbordo — acima disso a Visão geral destaca o indicador'),
  ('limiar_fraude_pre_pago', 3, 'Nº de contratos pré-pagos confirmados por cliente acima do qual um novo pedido gera alerta (Regra A)'),
  ('limiar_similaridade_estilo', 0.85, 'Similaridade mínima (0-1) do vetor estilométrico entre clientes de CPFs diferentes para gerar alerta (Regra C)')
ON CONFLICT (chave) DO NOTHING;
