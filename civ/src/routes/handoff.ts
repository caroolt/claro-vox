import { Router } from "express";
import { pool, audit } from "../db";
import { broadcast } from "../ws";
import { h } from "../asyncHandler";
import { requireAuth } from "../middleware/auth";

export const handoffRouter = Router();

// Cria o briefing + registro de handoff e marca a sessão como
// TRANSBORDO_PENDENTE — extraído da rota abaixo pra ser reaproveitado por
// qualquer lugar do CIV que precise acionar transbordo diretamente (sem
// passar pelo Orquestrador), como a divergência de identidade no
// reconhecimento do Cold Start (ver coldstart.ts).
export async function acionarHandoff(
  sessaoId: string,
  motivo: string,
  tomEmocional: string | null,
  resumoJornada: string,
  sugestaoResolucao: string,
  ator = "civ"
) {
  const canaisRes = await pool.query(
    `SELECT DISTINCT ca.nome FROM mensagem m JOIN canal ca ON ca.id = m.canal_id WHERE m.sessao_id = $1`,
    [sessaoId]
  );
  const canaisUtilizados = canaisRes.rows.map((r) => r.nome).join(", ");

  const briefingRes = await pool.query(
    `INSERT INTO briefing (sessao_id, resumo_jornada, canais_utilizados, tom_emocional, motivo_transbordo, sugestao_resolucao)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [sessaoId, resumoJornada, canaisUtilizados, tomEmocional, motivo, sugestaoResolucao]
  );
  await pool.query(`UPDATE sessao SET estado = 'TRANSBORDO_PENDENTE', atualizado_em = now() WHERE id = $1`, [sessaoId]);
  await pool.query(`INSERT INTO handoff (briefing_id, canal_origem) VALUES ($1, $2)`, [
    briefingRes.rows[0].id,
    canaisUtilizados.split(",")[0]?.trim(),
  ]);
  await audit(ator, "handoff.acionado", sessaoId);

  const briefingCompleto = await getBriefingCompleto(briefingRes.rows[0].id);
  broadcast("handoff.created", briefingCompleto);
  return briefingRes.rows[0];
}

// POST /v1/handoff — acionado pelo Orquestrador quando não resolve sozinho
// (RF007, RF009) — pública, chamada internamente, sem usuário logado.
handoffRouter.post("/", h(async (req, res) => {
  const { sessao_id, motivo, tom_emocional, resumo_jornada, sugestao_resolucao } = req.body || {};
  if (!sessao_id || !motivo) return res.status(400).json({ erro: "sessao_id e motivo são obrigatórios" });

  const briefing = await acionarHandoff(sessao_id, motivo, tom_emocional, resumo_jornada, sugestao_resolucao, "orchestrator");

  res.status(201).json({ briefing_id: briefing.id, estado: "TRANSBORDO_PENDENTE", sugestao_resolucao, notificado_em: new Date().toISOString() });
}));

// GET /v1/handoff — fila de briefings (histórico + pendentes) para o Vox Briefing
handoffRouter.get("/", requireAuth, h(async (req, res) => {
  const result = await pool.query(`
    SELECT b.*, s.estado AS sessao_estado, s.canal_origem_id, s.protocolo,
           cl.id AS cliente_id, cl.nome AS cliente_nome,
           ca.nome AS canal, h.atendente_id, h.assumido_em, h.encerrado_em,
           EXISTS (
             SELECT 1 FROM alerta_fraude af
             WHERE cl.id = ANY(af.clientes_ids) AND af.status = 'aberto' AND af.confianca = 'alta'
           ) AS possivel_fraude
    FROM briefing b
    JOIN sessao s ON s.id = b.sessao_id
    LEFT JOIN cliente cl ON cl.id = s.cliente_id
    LEFT JOIN canal ca ON ca.id = s.canal_origem_id
    LEFT JOIN handoff h ON h.briefing_id = b.id
    ORDER BY b.gerado_em DESC LIMIT 100
  `);
  res.json(result.rows);
}));

handoffRouter.get("/:id", requireAuth, h(async (req, res) => {
  const b = await getBriefingCompleto(req.params.id);
  if (!b) return res.status(404).json({ erro: "briefing não encontrado" });
  res.json(b);
}));

// POST /v1/handoff/:id/assumir — atendente humano assume a sessão. O
// atendente é sempre o dono do token (não confiamos mais em atendente_id
// vindo do corpo da requisição — antes era um valor fixo "atendente-demo").
handoffRouter.post("/:id/assumir", requireAuth, h(async (req, res) => {
  const atendenteNome = req.usuario!.nome;
  const briefingRes = await pool.query("SELECT * FROM briefing WHERE id = $1", [req.params.id]);
  if (!briefingRes.rows.length) return res.status(404).json({ erro: "briefing não encontrado" });
  await pool.query(`UPDATE handoff SET atendente_id = $1, assumido_em = now() WHERE briefing_id = $2`, [atendenteNome, req.params.id]);
  await pool.query(`UPDATE sessao SET estado = 'EM_ATENDIMENTO_HUMANO', atualizado_em = now() WHERE id = $1`, [briefingRes.rows[0].sessao_id]);
  await audit(req.usuario!.email, "handoff.assumido", req.params.id);
  broadcast("handoff.assumed", { briefing_id: req.params.id, sessao_id: briefingRes.rows[0].sessao_id, atendente_id: atendenteNome });
  res.json({ ok: true });
}));

// POST /v1/handoff/:id/encerrar
handoffRouter.post("/:id/encerrar", requireAuth, h(async (req, res) => {
  const briefingRes = await pool.query("SELECT * FROM briefing WHERE id = $1", [req.params.id]);
  if (!briefingRes.rows.length) return res.status(404).json({ erro: "briefing não encontrado" });
  await pool.query(`UPDATE handoff SET encerrado_em = now() WHERE briefing_id = $1`, [req.params.id]);
  await pool.query(`UPDATE sessao SET estado = 'ENCERRADA', atualizado_em = now() WHERE id = $1`, [briefingRes.rows[0].sessao_id]);
  broadcast("handoff.closed", { briefing_id: req.params.id, sessao_id: briefingRes.rows[0].sessao_id });
  res.json({ ok: true });
}));

async function getBriefingCompleto(id: string) {
  const result = await pool.query(`
    SELECT b.*, s.estado AS sessao_estado, s.id AS sessao_id, s.protocolo, cl.nome AS cliente_nome, cl.tipo_cliente,
           h.atendente_id, h.assumido_em, h.encerrado_em,
           EXISTS (
             SELECT 1 FROM alerta_fraude af
             WHERE cl.id = ANY(af.clientes_ids) AND af.status = 'aberto' AND af.confianca = 'alta'
           ) AS possivel_fraude
    FROM briefing b
    JOIN sessao s ON s.id = b.sessao_id
    LEFT JOIN cliente cl ON cl.id = s.cliente_id
    LEFT JOIN handoff h ON h.briefing_id = b.id
    WHERE b.id = $1
  `, [id]);
  return result.rows[0] || null;
}
