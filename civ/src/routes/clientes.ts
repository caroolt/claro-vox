import { Router } from "express";
import { pool, audit } from "../db";
import { h } from "../asyncHandler";

export const clientesRouter = Router();

// DELETE /v1/clientes/:id — direito de exclusão da LGPD (art. 18), Seção 4.7
clientesRouter.delete("/:id", h(async (req, res) => {
  const { id } = req.params;
  const cliente = await pool.query("SELECT id FROM cliente WHERE id = $1", [id]);
  if (!cliente.rows.length) return res.status(404).json({ erro: "cliente não encontrado" });

  await pool.query(
    `UPDATE cliente SET nome = '[excluído a pedido do titular]', cpf_hash = NULL, telefone = NULL WHERE id = $1`,
    [id]
  );
  await pool.query(
    `UPDATE briefing SET resumo_jornada = '[anonimizado]' WHERE sessao_id IN (SELECT id FROM sessao WHERE cliente_id = $1)`,
    [id]
  );
  await audit("civ", "lgpd.exclusao", id);
  res.json({ ok: true, mensagem: "Dados do titular anonimizados conforme art. 18 da LGPD." });
}));
