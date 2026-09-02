import { Router } from "express";
import { pool, audit } from "../db";
import { getOrCreateCanal } from "../helpers";
import { cacheSessionContext } from "../redisClient";
import { broadcast } from "../ws";
import { h } from "../asyncHandler";

export const sessionsRouter = Router();

// GET /v1/sessions — lista para o painel "Sessões Ativas" do Vox Briefing
sessionsRouter.get("/", h(async (req, res) => {
  const somenteAtivas = req.query.ativas !== "false";
  const where = somenteAtivas ? "WHERE s.estado NOT IN ('ENCERRADA')" : "";
  const result = await pool.query(`
    SELECT s.id, s.estado, s.criado_em, s.atualizado_em,
           cl.nome AS cliente_nome, cl.tipo_cliente,
           ca.nome AS canal,
           ctx.ultima_intencao, ctx.jornada_status
    FROM sessao s
    LEFT JOIN cliente cl ON cl.id = s.cliente_id
    LEFT JOIN canal ca ON ca.id = s.canal_origem_id
    LEFT JOIN contexto ctx ON ctx.sessao_id = s.id
    ${where}
    ORDER BY s.atualizado_em DESC
    LIMIT 100
  `);
  res.json(result.rows);
}));

// GET /v1/sessions/:id/context — contrato documentado na Seção 4.5.2
sessionsRouter.get("/:id/context", h(async (req, res) => {
  const { id } = req.params;
  const sessaoRes = await pool.query(
    `SELECT s.*, cl.nome AS cliente_nome, cl.tipo_cliente, ca.nome AS canal_nome
     FROM sessao s LEFT JOIN cliente cl ON cl.id = s.cliente_id LEFT JOIN canal ca ON ca.id = s.canal_origem_id
     WHERE s.id = $1`,
    [id]
  );
  if (!sessaoRes.rows.length) return res.status(404).json({ erro: "sessão não encontrada" });
  const sessao = sessaoRes.rows[0];
  const contextoRes = await pool.query("SELECT * FROM contexto WHERE sessao_id = $1", [id]);
  await audit("civ", "sessions.context.read", id);
  res.json({
    sessao_id: id,
    estado: sessao.estado,
    cliente: sessao.cliente_id ? { id: sessao.cliente_id, nome: sessao.cliente_nome, tipo_cliente: sessao.tipo_cliente } : null,
    canal_atual: contextoRes.rows[0]?.canal_atual || sessao.canal_nome,
    canal_anterior: contextoRes.rows[0]?.canal_anterior || null,
    ultima_intencao: contextoRes.rows[0]?.ultima_intencao || null,
    historico_resumido: contextoRes.rows[0]?.historico_resumido || null,
    atualizado_em: sessao.atualizado_em,
  });
}));

// GET /v1/sessions/:id/messages — histórico de mensagens de uma sessão
sessionsRouter.get("/:id/messages", h(async (req, res) => {
  const result = await pool.query(
    `SELECT m.id, m.remetente, m.conteudo, m.timestamp, ca.nome AS canal
     FROM mensagem m LEFT JOIN canal ca ON ca.id = m.canal_id
     WHERE m.sessao_id = $1 ORDER BY m.timestamp ASC`,
    [req.params.id]
  );
  res.json(result.rows);
}));

// POST /v1/sessions/:id/messages — usado pelo Orquestrador para registrar
// a mensagem do cliente e a resposta do Vox
sessionsRouter.post("/:id/messages", h(async (req, res) => {
  const { id } = req.params;
  const { remetente, canal, conteudo } = req.body || {};
  if (!remetente || !conteudo) return res.status(400).json({ erro: "remetente e conteudo são obrigatórios" });
  const canalId = canal ? await getOrCreateCanal(canal) : null;
  const result = await pool.query(
    `INSERT INTO mensagem (sessao_id, canal_id, remetente, conteudo) VALUES ($1, $2, $3, $4) RETURNING id, timestamp`,
    [id, canalId, remetente, conteudo]
  );
  await pool.query(`UPDATE sessao SET atualizado_em = now() WHERE id = $1`, [id]);
  broadcast("message.created", { sessao_id: id, remetente, conteudo, canal });
  res.status(201).json({ mensagem_id: result.rows[0].id, timestamp: result.rows[0].timestamp });
}));

// POST /v1/sessions/:id/intencao — o Orquestrador registra a classificação
// (categoria, subcategoria, confiança, tom emocional) de uma mensagem (RF002, RF008)
sessionsRouter.post("/:id/intencao", h(async (req, res) => {
  const { id } = req.params;
  const { mensagem_id, categoria, subcategoria, confianca, tom_emocional, jornada_status } = req.body || {};
  if (mensagem_id) {
    await pool.query(
      `INSERT INTO intencao (mensagem_id, categoria, subcategoria, confianca, tom_emocional) VALUES ($1, $2, $3, $4, $5)`,
      [mensagem_id, categoria, subcategoria, confianca, tom_emocional]
    );
  }
  const contextoRes = await pool.query(
    `UPDATE contexto SET ultima_intencao = $1, jornada_status = COALESCE($2, jornada_status), atualizado_em = now()
     WHERE sessao_id = $3 RETURNING *`,
    [JSON.stringify({ categoria, subcategoria, confianca, tom_emocional }), jornada_status, id]
  );
  if (contextoRes.rows[0]) await cacheSessionContext(id, contextoRes.rows[0]);
  await audit("orchestrator", "intencao.registrada", id);
  broadcast("intencao.updated", { sessao_id: id, categoria, subcategoria, tom_emocional });
  res.status(201).json({ ok: true });
}));
