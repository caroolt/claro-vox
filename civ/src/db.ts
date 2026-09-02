import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://clarovox:clarovox_dev_pw@localhost:5432/claro_vox",
});

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
