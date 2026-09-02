import { pool } from "./db";

const canalCache = new Map<string, string>();

export async function getOrCreateCanal(nome: string, tipoAdapter = "generic"): Promise<string> {
  if (canalCache.has(nome)) return canalCache.get(nome)!;
  const existing = await pool.query("SELECT id FROM canal WHERE nome = $1", [nome]);
  if (existing.rows.length) {
    canalCache.set(nome, existing.rows[0].id);
    return existing.rows[0].id;
  }
  const created = await pool.query(
    "INSERT INTO canal (nome, tipo_adapter) VALUES ($1, $2) RETURNING id",
    [nome, tipoAdapter]
  );
  canalCache.set(nome, created.rows[0].id);
  return created.rows[0].id;
}

export function maskCpfHash(cpfHash: string | null): string {
  return cpfHash ? "***hash***" : "";
}
