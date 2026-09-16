import { Router } from "express";
import { pool, audit } from "../db";
import { h } from "../asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";

export const configuracoesRouter = Router();

// Parâmetros operacionais — meta de transbordo e limiares do motor de
// detecção de fraude, em vez de constantes fixas no código (ver
// civ/schema.sql: configuracao). Editar é exclusivo do admin (aba
// "Configurações"), mas ler é liberado pra qualquer usuário autenticado —
// o atendente também precisa saber, por exemplo, o timeout de inatividade
// pra avisar o cliente na mensagem de abertura (ver AgentPanel.tsx).
configuracoesRouter.use(requireAuth);

// GET /v1/configuracoes — lista todos os parâmetros.
configuracoesRouter.get("/", h(async (_req, res) => {
  const result = await pool.query(
    `SELECT chave, valor, descricao, atualizado_em, atualizado_por FROM configuracao ORDER BY chave`
  );
  res.json(result.rows.map((r) => ({ ...r, valor: Number(r.valor) })));
}));

// PUT /v1/configuracoes/:chave — atualiza um parâmetro existente. Não cria
// chaves novas por aqui (evita configurações "soltas" sem uso no código).
configuracoesRouter.put("/:chave", requireRole("admin"), h(async (req, res) => {
  const { chave } = req.params;
  const { valor } = req.body || {};
  if (typeof valor !== "number" || !Number.isFinite(valor)) {
    return res.status(400).json({ erro: "valor deve ser um número" });
  }

  const atual = await pool.query("SELECT chave FROM configuracao WHERE chave = $1", [chave]);
  if (!atual.rows.length) return res.status(404).json({ erro: "parâmetro de configuração não encontrado" });

  const result = await pool.query(
    `UPDATE configuracao SET valor = $1, atualizado_em = now(), atualizado_por = $2 WHERE chave = $3
     RETURNING chave, valor, descricao, atualizado_em, atualizado_por`,
    [valor, req.usuario!.sub, chave]
  );
  await audit(req.usuario!.email, "configuracoes.atualizado", chave);
  res.json({ ...result.rows[0], valor: Number(result.rows[0].valor) });
}));
