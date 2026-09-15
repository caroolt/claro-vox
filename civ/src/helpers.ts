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

// Protocolo de atendimento — identifica a sessão/chamada para o cliente,
// independente do canal (é o número que ele guarda/anota). Formato curto e
// falável por telefone: VX-AAAAMMDD-XXXX (4 caracteres alfanuméricos,
// sem 0/O/1/I para não confundir ao ditar).
const ALFABETO_PROTOCOLO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function sufixoAleatorio(tamanho = 4): string {
  let s = "";
  for (let i = 0; i < tamanho; i++) {
    s += ALFABETO_PROTOCOLO[Math.floor(Math.random() * ALFABETO_PROTOCOLO.length)];
  }
  return s;
}

export async function gerarProtocolo(pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> }): Promise<string> {
  const data = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const protocolo = `VX-${data}-${sufixoAleatorio()}`;
    const existente = await pool.query("SELECT 1 FROM sessao WHERE protocolo = $1", [protocolo]);
    if (!existente.rows.length) return protocolo;
  }
  // Extremamente improvável (colisão 5x seguidas) — cai para um sufixo maior.
  return `VX-${data}-${sufixoAleatorio(8)}`;
}
