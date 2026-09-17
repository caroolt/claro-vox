import { executarDeteccaoFraude } from "../fraudeDeteccao";

// Roda periodicamente (ver setInterval em index.ts) — único disparador do
// motor de detecção (GET /v1/fraude/alertas virou leitura pura, não roda
// mais a detecção a cada abertura da aba). A Regra A continua checada em
// tempo real de verdade no momento da contratação (ver contratos.ts), esse
// job cobre as Regras B e C (e a reconciliação/agrupamento em casos).
export async function rodarDeteccaoFraudePeriodica() {
  try {
    await executarDeteccaoFraude();
  } catch (e) {
    console.error("[deteccao-fraude] falha na checagem periódica:", (e as Error).message);
  }
}
