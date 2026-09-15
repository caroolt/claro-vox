import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://clarovox:clarovox_dev_pw@localhost:5432/claro_vox",
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
