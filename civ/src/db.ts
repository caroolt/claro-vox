import { Pool } from "pg";

// DATABASE_SSL=true liga TLS sem verificar a cadeia de certificado — modo
// exigido por bancos gerenciados externos (ex.: Supabase) que não expõem o
// certificado raiz para validação. Fica desligado por padrão (Postgres
// local/docker-compose não usa TLS).
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://clarovox:clarovox_dev_pw@localhost:5432/claro_vox",
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

// O schema.sql só é aplicado pelo Postgres em volume novo (script de
// docker-entrypoint-initdb.d). Para que tabelas adicionadas depois passem
// a existir em bancos já criados, garantimos as mais recentes no boot da
// CIV — sempre idempotente (CREATE TABLE IF NOT EXISTS).
export async function ensureSchema() {
  await pool.query(`
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
  `);
  // Contas do Painel do Atendente (Vox Briefing) — autenticação com senha +
  // MFA (TOTP) e RBAC (admin / atendente). O simulador de cliente e as
  // chamadas internas do Orquestrador não usam essa tabela.
  await pool.query(`
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
  `);
  // Protocolo de atendimento (identifica a sessão/chamada pro cliente,
  // independente de canal) e o fluxo conversacional guiado em andamento
  // (ex.: contratação de plano).
  await pool.query(`ALTER TABLE sessao ADD COLUMN IF NOT EXISTS protocolo TEXT UNIQUE`);
  await pool.query(`ALTER TABLE contexto ADD COLUMN IF NOT EXISTS fluxo_ativo TEXT`);
  await pool.query(`ALTER TABLE contexto ADD COLUMN IF NOT EXISTS fluxo_dados JSONB`);
  await pool.query(`ALTER TABLE cliente ADD COLUMN IF NOT EXISTS data_nascimento DATE`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contrato (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cliente_id       UUID NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
      sessao_id        UUID NOT NULL REFERENCES sessao(id) ON DELETE CASCADE,
      tipo_plano       TEXT NOT NULL CHECK (tipo_plano IN ('pre-pago','controle','pos-pago')),
      protocolo        TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'confirmado' CHECK (status IN ('confirmado','cancelado')),
      criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Camada de detecção de fraude cross-canal — sinais cross-identidade na
  // sessão (dispositivo/IP, já que CPF sozinho não liga clientes distintos),
  // parâmetros editáveis pelo admin e os alertas gerados pelo motor de regras.
  await pool.query(`ALTER TABLE sessao ADD COLUMN IF NOT EXISTS dispositivo_id TEXT`);
  await pool.query(`ALTER TABLE sessao ADD COLUMN IF NOT EXISTS ip_origem TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS configuracao (
      chave          TEXT PRIMARY KEY,
      valor          NUMERIC NOT NULL,
      descricao      TEXT,
      atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_por UUID REFERENCES usuario(id)
    );
  `);
  await pool.query(`
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
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessao_dispositivo ON sessao(dispositivo_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessao_ip ON sessao(ip_origem)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_alerta_fraude_status ON alerta_fraude(status)`);

  // Bloqueio manual do cliente a partir de um alerta de fraude (aba Fraude)
  // — ação de baixo atrito ao lado de "marcar como revisado/descartado".
  await pool.query(`ALTER TABLE cliente ADD COLUMN IF NOT EXISTS bloqueado BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE cliente ADD COLUMN IF NOT EXISTS bloqueado_em TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE cliente ADD COLUMN IF NOT EXISTS bloqueado_motivo TEXT`);

  // Trilha de quem revisou um alerta de fraude, quando, e (para 'revisado')
  // o resumo da investigação — exigido no momento de marcar como revisado.
  await pool.query(`ALTER TABLE alerta_fraude ADD COLUMN IF NOT EXISTS resolvido_em TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE alerta_fraude ADD COLUMN IF NOT EXISTS resolvido_por TEXT`);
  await pool.query(`ALTER TABLE alerta_fraude ADD COLUMN IF NOT EXISTS nota_resolucao TEXT`);

  await pool.query(`
    INSERT INTO configuracao (chave, valor, descricao) VALUES
      ('meta_transbordo_pct', 25, 'Meta (%) da taxa de transbordo. Acima disso, a Visão geral destaca o indicador'),
      ('limiar_fraude_pre_pago', 3, 'Nº de contratos pré-pagos confirmados por cliente acima do qual um novo pedido gera alerta (Regra A)'),
      ('limiar_similaridade_estilo', 0.85, 'Similaridade mínima (0-1) do vetor estilométrico entre clientes de CPFs diferentes para gerar alerta (Regra C)'),
      ('timeout_atendente_min', 15, 'Minutos sem nenhuma mensagem numa sessão em atendimento humano até ela ser encerrada automaticamente')
    ON CONFLICT (chave) DO NOTHING
  `);
}

export async function audit(ator: string, acao: string, recursoId?: string) {
  try {
    await pool.query(
      "INSERT INTO auditoria (ator, acao, recurso_id) VALUES ($1, $2, $3)",
      [ator, acao, recursoId || null]
    );
  } catch (e) {
    // auditoria nunca deve derrubar a requisição principal
    console.error("[auditoria] falha ao registrar:", (e as Error).message);
  }
}
