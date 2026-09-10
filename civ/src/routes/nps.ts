import { Router } from "express";
import { pool, audit } from "../db";
import { broadcast } from "../ws";
import { h } from "../asyncHandler";

export const npsRouter = Router();

// POST /v1/nps — registra a nota de NPS enviada pelo cliente no simulador.
// `alvo` = "ia" (pesquisa junto ao transbordo) ou "atendente" (pesquisa ao
// encerrar o atendimento humano). Uma resposta por sessão e por alvo — um
// reenvio atualiza a nota/comentário.
npsRouter.post("/", h(async (req, res) => {
  const { sessao_id, alvo, nota, comentario, briefing_id, atendente_id } = req.body || {};
  if (!sessao_id || !alvo) return res.status(400).json({ erro: "sessao_id e alvo são obrigatórios" });
  if (alvo !== "ia" && alvo !== "atendente") return res.status(400).json({ erro: "alvo deve ser 'ia' ou 'atendente'" });
  const notaNum = Number(nota);
  if (!Number.isInteger(notaNum) || notaNum < 0 || notaNum > 10) {
    return res.status(400).json({ erro: "nota deve ser um inteiro entre 0 e 10" });
  }

  const result = await pool.query(
    `INSERT INTO nps (sessao_id, alvo, nota, comentario, briefing_id, atendente_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (sessao_id, alvo)
     DO UPDATE SET nota = EXCLUDED.nota, comentario = EXCLUDED.comentario,
                   briefing_id = COALESCE(EXCLUDED.briefing_id, nps.briefing_id),
                   atendente_id = COALESCE(EXCLUDED.atendente_id, nps.atendente_id),
                   criado_em = now()
     RETURNING id`,
    [sessao_id, alvo, notaNum, comentario || null, briefing_id || null, atendente_id || null]
  );

  await audit("cliente", `nps.registrado.${alvo}`, sessao_id);
  broadcast("nps.created", { sessao_id, alvo, nota: notaNum });
  res.status(201).json({ ok: true, nps_id: result.rows[0].id });
}));
