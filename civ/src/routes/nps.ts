import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db";
import { broadcast } from "../ws";
import { h } from "../asyncHandler";
import { validateBody } from "../validate";

export const npsRouter = Router();

const npsSchema = z.object({
  sessao_id: z.string().trim().min(1, "sessao_id é obrigatório"),
  alvo: z.enum(["ia", "atendente"], { errorMap: () => ({ message: "alvo deve ser 'ia' ou 'atendente'" }) }),
  nota: z.coerce.number().int("nota deve ser um inteiro entre 0 e 10").min(0).max(10),
  comentario: z.string().trim().optional(),
  briefing_id: z.string().trim().min(1).nullable().optional(),
  atendente_id: z.string().trim().min(1).nullable().optional(),
});

// POST /v1/nps — registra a nota de NPS enviada pelo cliente no simulador.
// `alvo` = "ia" (pesquisa junto ao transbordo) ou "atendente" (pesquisa ao
// encerrar o atendimento humano). Uma resposta por sessão e por alvo — um
// reenvio atualiza a nota/comentário.
npsRouter.post("/", validateBody(npsSchema), h(async (req, res) => {
  const { sessao_id, alvo, nota, comentario, briefing_id, atendente_id } = req.body;

  const result = await pool.query(
    `INSERT INTO nps (sessao_id, alvo, nota, comentario, briefing_id, atendente_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (sessao_id, alvo)
     DO UPDATE SET nota = EXCLUDED.nota, comentario = EXCLUDED.comentario,
                   briefing_id = COALESCE(EXCLUDED.briefing_id, nps.briefing_id),
                   atendente_id = COALESCE(EXCLUDED.atendente_id, nps.atendente_id),
                   criado_em = now()
     RETURNING id`,
    [sessao_id, alvo, nota, comentario || null, briefing_id || null, atendente_id || null]
  );

  await audit("cliente", `nps.registrado.${alvo}`, sessao_id);
  broadcast("nps.created", { sessao_id, alvo, nota });
  res.status(201).json({ ok: true, nps_id: result.rows[0].id });
}));
