import { pool, audit } from "../db";
import { broadcast } from "../ws";

// Mesmo texto anunciado de antemão pelo atendente na mensagem de abertura
// automática (ver responder() em AgentPanel.tsx) — o cliente já foi avisado
// que isso pode acontecer.
const MENSAGEM_TIMEOUT =
  "Bom, parece que você não pode responder agora! Estamos encerrando a conversa, mas você pode chamar a qualquer momento para retomar a conversa!";

// Roda periodicamente (ver setInterval em index.ts): encerra sozinha
// qualquer sessão EM_ATENDIMENTO_HUMANO que ficou sem nenhuma mensagem
// (de nenhum lado) por mais tempo que o configurado — sem isso, um cliente
// que simplesmente sumiu deixava a sessão "presa" indefinidamente na fila
// do atendente. Cada sessão só tem um handoff aberto por vez, então
// DISTINCT ON (s.id) sempre pega o briefing/handoff certo mesmo que a
// sessão já tenha tido transbordos anteriores encerrados.
export async function verificarTimeoutsAtendente() {
  try {
    const limiarRes = await pool.query(`SELECT valor FROM configuracao WHERE chave = 'timeout_atendente_min'`);
    const minutos = limiarRes.rows.length ? Number(limiarRes.rows[0].valor) : 15;
    if (!(minutos > 0)) return;

    const staleRes = await pool.query(
      `
      SELECT DISTINCT ON (s.id) s.id AS sessao_id, s.canal_origem_id, b.id AS briefing_id
      FROM sessao s
      JOIN briefing b ON b.sessao_id = s.id
      JOIN handoff h ON h.briefing_id = b.id
      WHERE s.estado = 'EM_ATENDIMENTO_HUMANO'
        AND h.encerrado_em IS NULL
        AND s.atualizado_em < now() - make_interval(mins => $1::int)
      ORDER BY s.id, b.gerado_em DESC
      `,
      [minutos]
    );

    for (const row of staleRes.rows) {
      await pool.query(`INSERT INTO mensagem (sessao_id, canal_id, remetente, conteudo) VALUES ($1, $2, 'vox', $3)`, [
        row.sessao_id,
        row.canal_origem_id,
        MENSAGEM_TIMEOUT,
      ]);
      await pool.query(`UPDATE handoff SET encerrado_em = now() WHERE briefing_id = $1`, [row.briefing_id]);
      await pool.query(`UPDATE sessao SET estado = 'ENCERRADA', atualizado_em = now() WHERE id = $1`, [row.sessao_id]);
      await audit("civ", "sessao.timeout_atendente", row.sessao_id);
      // Evento dedicado (em vez de reaproveitar "message.created"/"handoff.closed")
      // pro simulador de cliente saber, sem ambiguidade, que foi um
      // encerramento automático por inatividade — não pelo atendente — e
      // já se preparar para abrir uma sessão nova no próximo envio.
      broadcast("handoff.timeout", { sessao_id: row.sessao_id, briefing_id: row.briefing_id, mensagem: MENSAGEM_TIMEOUT });
    }
  } catch (e) {
    console.error("[timeout-atendente] falha ao verificar sessões inativas:", (e as Error).message);
  }
}
