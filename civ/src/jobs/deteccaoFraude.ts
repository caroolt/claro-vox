import { executarDeteccaoFraude } from "../routes/fraude";

// Roda periodicamente (ver setInterval em index.ts): sem isso, as Regras
// B e C só eram avaliadas quando alguém tinha a aba Fraude aberta (GET
// /fraude/alertas), então um alerta novo só aparecia da próxima vez que o
// admin abrisse/recarregasse a aba — não em tempo real. A Regra A continua
// checada em tempo real de verdade no momento da contratação (ver
// contratos.ts), esse job cobre as outras duas.
export async function rodarDeteccaoFraudePeriodica() {
  try {
    await executarDeteccaoFraude();
  } catch (e) {
    console.error("[deteccao-fraude] falha na checagem periódica:", (e as Error).message);
  }
}
