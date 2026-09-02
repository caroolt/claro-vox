import { Router } from "express";
import { pool, audit } from "../db";
import { broadcast } from "../ws";
import { h } from "../asyncHandler";

export const handoffRouter = Router();

// POST /v1/handoff — acionado pelo Orquestrador quando não resolve sozinho (RF007, RF009)
handoffRouter.post("/", h(async (req, res) => {
  const { sessao_id, motivo, tom_emocional, resumo_jornada, sugestao_resolucao } = req.body || {};
  if (!sessao_id || !motivo) return res.status(400).json({ erro: "sessao_id e motivo são obrigatórios" });

  const canaisRes = await pool.query(
    `SELECT DISTINCT ca.nome FROM mensagem m JOIN canal ca ON ca.id = m.canal_id WHERE m.sessao_id = $1`,
    [sessao_id]
  );
  const canaisUtilizados = canaisRes.rows.map((r) => r.nome).join(", ");

  const briefingRes = await pool.query(
    `INSERT INTO briefing (sessao_id, resumo_jornada, canais_utilizados, tom_emocional, motivo_transbordo, sugestao_resolucao)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [sessao_id, resumo_jornada, canaisUtilizados, tom_emocional, motivo, sugestao_resolucao]
  );
  await pool.query(`UPDATE sessao SET estado = 'TRANSBORDO_PENDENTE', atualizado_em = now() WHERE id = $1`, [sessao_id]);
  await pool.query(`INSERT INTO handoff (briefing_id, canal_origem) VALUES ($1, $2)`, [briefingRes.rows[0].id, canaisUtilizados.split(",")[0]?.trim()]);
  await audit("orchestrator", "handoff.acionado", sessao_id);

  const briefingCompleto = await getBriefingCompleto(briefingRes.rows[0].id);
  broadcast("handoff.created", briefingCompleto);

  res.status(201).json({ briefing_id: briefingRes.rows[0].id, estado: "TRANSBORDO_PENDENTE", sugestao_resolucao, notificado_em: new Date().toISOString() });
}));

// GET /v1/handoff — fila de briefings (histórico + pendentes) para o Vox Briefing
handoffRouter.get("/", h(async (req, res) => {
  const result = await pool.query(`
    SELECT b.*, s.estado AS sessao_estado, cl.nome AS cliente_nome, h.atendente_id, h.assumido_em, h.encerrado_em
    FROM briefing b
    JOIN sessao s ON s.id = b.sessao_id
    LEFT JOIN cliente cl ON cl.id = s.cliente_id
    LEFT JOIN handoff h ON h.briefing_id = b.id
    ORDER BY b.gerado_em DESC LIMIT 100
  `);
  res.json(result.rows);
}));

handoffRouter.get("/:id", h(async (req, res) => {
  const b = await getBriefingCompleto(req.params.id);
  if (!b) return res.status(404).json({ erro: "briefing não encontrado" });
  res.json(b);
}));

// POST /v1/handoff/:id/assumir — atendente humano assume a sessão
handoffRouter.post("/:id/assumir", h(async (req, res) => {
  const { atendente_id } = req.body || {};
  const briefingRes = await pool.query("SELECT * FROM briefing WHERE id = $1", [req.params.id]);
  if (!briefingRes.rows.length) return res.status(404).json({ erro: "briefing não encontrado" });
  await pool.query(`UPDATE handoff SET atendente_id = $1, assumido_em = now() WHERE briefing_id = $2`, [atendente_id || "atendente-demo", req.params.id]);
  await pool.query(`UPDATE sessao SET estado = 'EM_ATENDIMENTO_HUMANO', atualizado_em = now() WHERE id = $1`, [briefingRes.rows[0].sessao_id]);
  await audit(atendente_id || "atendente-demo", "handoff.assumido", req.params.id);
  broadcast("handoff.assumed", { briefing_id: req.params.id, sessao_id: briefingRes.rows[0].sessao_id, atendente_id });
  res.json({ ok: true });
}));

// POST /v1/handoff/:id/encerrar
handoffRouter.post("/:id/encerrar", h(async (req, res) => {
  const briefingRes = await pool.query("SELECT * FROM briefing WHERE id = $1", [req.params.id]);
  if (!briefingRes.rows.length) return res.status(404).json({ erro: "briefing não encontrado" });
  await pool.query(`UPDATE handoff SET encerrado_em = now() WHERE briefing_id = $1`, [req.params.id]);
  await pool.query(`UPDATE sessao SET estado = 'ENCERRADA', atualizado_em = now() WHERE id = $1`, [briefingRes.rows[0].sessao_id]);
  broadcast("handoff.closed", { briefing_id: req.params.id, sessao_id: briefingRes.rows[0].sessao_id });
  res.json({ ok: true });
}));

async function getBriefingCompleto(id: string) {
  const result = await pool.query(`
    SELECT b.*, s.estado AS sessao_estado, s.id AS sessao_id, cl.nome AS cliente_nome, cl.tipo_cliente,
           h.atendente_id, h.assumido_em, h.encerrado_em
    FROM briefing b
    JOIN sessao s ON s.id = b.sessao_id
    LEFT JOIN cliente cl ON cl.id = s.cliente_id
    LEFT JOIN handoff h ON h.briefing_id = b.id
    WHERE b.id = $1
  `, [id]);
  return result.rows[0] || null;
}
