import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db";
import { getOrCreateCanal } from "../helpers";
import { cacheSessionContext } from "../redisClient";
import { broadcast } from "../ws";
import { h } from "../asyncHandler";
import { scrubTexto } from "../anonimizar";
import { embed } from "../embedding";
import { requireAuth } from "../middleware/auth";
import { validateBody } from "../validate";

export const sessionsRouter = Router();

const fluxoSchema = z.object({
  fluxo_ativo: z.string().trim().min(1).nullable().optional(),
  fluxo_dados: z.unknown().optional(),
});

const mensagemSchema = z.object({
  remetente: z.enum(["atendente", "cliente", "vox"], {
    errorMap: () => ({ message: "remetente deve ser 'atendente', 'cliente' ou 'vox'" }),
  }),
  canal: z.string().trim().min(1).optional(),
  conteudo: z.string().trim().min(1, "conteudo é obrigatório"),
});

const intencaoSchema = z.object({
  mensagem_id: z.string().trim().min(1).optional(),
  categoria: z.string().trim().optional(),
  subcategoria: z.string().trim().optional(),
  confianca: z.number().optional(),
  tom_emocional: z.string().trim().optional(),
  jornada_status: z.string().trim().optional(),
});

// GET /v1/sessions — lista para o painel "Sessões Ativas" do Vox Briefing
// (protegida — o Orquestrador não usa esta rota, só o front do painel).
sessionsRouter.get("/", requireAuth, h(async (req, res) => {
  const somenteAtivas = req.query.ativas !== "false";
  const where = somenteAtivas ? "WHERE s.estado NOT IN ('ENCERRADA')" : "";
  const result = await pool.query(`
    SELECT s.id, s.estado, s.criado_em, s.atualizado_em, s.protocolo,
           cl.id AS cliente_id, cl.nome AS cliente_nome, cl.tipo_cliente,
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
// (pública — chamada internamente pelo Orquestrador a cada mensagem).
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
    protocolo: sessao.protocolo,
    cliente: sessao.cliente_id ? { id: sessao.cliente_id, nome: sessao.cliente_nome, tipo_cliente: sessao.tipo_cliente } : null,
    canal_atual: contextoRes.rows[0]?.canal_atual || sessao.canal_nome,
    canal_anterior: contextoRes.rows[0]?.canal_anterior || null,
    ultima_intencao: contextoRes.rows[0]?.ultima_intencao || null,
    historico_resumido: contextoRes.rows[0]?.historico_resumido || null,
    fluxo_ativo: contextoRes.rows[0]?.fluxo_ativo || null,
    fluxo_dados: contextoRes.rows[0]?.fluxo_dados || null,
    atualizado_em: sessao.atualizado_em,
  });
}));

// POST /v1/sessions/:id/fluxo — o Orquestrador usa isso para guardar em que
// etapa está um fluxo conversacional guiado (ex.: contratação de plano) e
// os dados já coletados, ou para encerrar o fluxo (fluxo_ativo: null).
// Pública — mesma natureza de /context e /intencao, uso interno do Orquestrador.
sessionsRouter.post("/:id/fluxo", validateBody(fluxoSchema), h(async (req, res) => {
  const { id } = req.params;
  const { fluxo_ativo, fluxo_dados } = req.body;
  const result = await pool.query(
    `UPDATE contexto SET fluxo_ativo = $1, fluxo_dados = $2, atualizado_em = now() WHERE sessao_id = $3 RETURNING *`,
    [fluxo_ativo || null, fluxo_dados ? JSON.stringify(fluxo_dados) : null, id]
  );
  if (!result.rows.length) return res.status(404).json({ erro: "contexto da sessão não encontrado" });
  await cacheSessionContext(id, result.rows[0]);
  res.json({ ok: true });
}));

// GET /v1/sessions/:id/messages — histórico de mensagens de uma sessão
sessionsRouter.get("/:id/messages", requireAuth, h(async (req, res) => {
  const result = await pool.query(
    `SELECT m.id, m.remetente, m.conteudo, m.timestamp, ca.nome AS canal
     FROM mensagem m LEFT JOIN canal ca ON ca.id = m.canal_id
     WHERE m.sessao_id = $1 ORDER BY m.timestamp ASC`,
    [req.params.id]
  );
  res.json(result.rows);
}));

// GET /v1/sessions/:id/transcript — transcrição da conversa já anonimizada,
// para exportar em PDF sem vazar dado pessoal do titular (ver anonimizar.ts).
sessionsRouter.get("/:id/transcript", requireAuth, h(async (req, res) => {
  const { id } = req.params;
  const sessaoRes = await pool.query(
    `SELECT s.id, s.estado, s.criado_em, s.atualizado_em,
            cl.nome AS cliente_nome, cl.tipo_cliente, ca.nome AS canal
     FROM sessao s
     LEFT JOIN cliente cl ON cl.id = s.cliente_id
     LEFT JOIN canal ca ON ca.id = s.canal_origem_id
     WHERE s.id = $1`,
    [id]
  );
  if (!sessaoRes.rows.length) return res.status(404).json({ erro: "sessão não encontrada" });
  const s = sessaoRes.rows[0];
  const nome = s.cliente_nome as string | null;

  const [msgsRes, briefingRes, tomRes] = await Promise.all([
    pool.query(
      `SELECT m.remetente, m.conteudo, m.timestamp
       FROM mensagem m WHERE m.sessao_id = $1 ORDER BY m.timestamp ASC`,
      [id]
    ),
    pool.query(
      `SELECT motivo_transbordo, tom_emocional, resumo_jornada, sugestao_resolucao, canais_utilizados
       FROM briefing WHERE sessao_id = $1 ORDER BY gerado_em DESC LIMIT 1`,
      [id]
    ),
    pool.query(
      `SELECT i.tom_emocional, COUNT(*) AS total
       FROM intencao i JOIN mensagem m ON m.id = i.mensagem_id
       WHERE m.sessao_id = $1 AND i.tom_emocional IS NOT NULL
       GROUP BY i.tom_emocional ORDER BY total DESC LIMIT 1`,
      [id]
    ),
  ]);

  const b = briefingRes.rows[0];
  await audit("civ", "sessions.transcript.export", id);

  res.json({
    sessao: {
      id: s.id,
      estado: s.estado,
      canal: s.canal,
      criado_em: s.criado_em,
      atualizado_em: s.atualizado_em,
    },
    cliente: { rotulo: "Cliente", tipo_cliente: s.tipo_cliente },
    tom_predominante: tomRes.rows[0]?.tom_emocional || null,
    briefing: b
      ? {
          motivo_transbordo: scrubTexto(b.motivo_transbordo, nome),
          tom_emocional: b.tom_emocional,
          resumo_jornada: scrubTexto(b.resumo_jornada, nome),
          sugestao_resolucao: scrubTexto(b.sugestao_resolucao, nome),
          canais_utilizados: b.canais_utilizados,
        }
      : null,
    mensagens: msgsRes.rows.map((m) => ({
      remetente: m.remetente,
      conteudo: scrubTexto(m.conteudo, nome),
      timestamp: m.timestamp,
    })),
  });
}));

// GET /v1/sessions/:id/suggestions — artigos da base de conhecimento
// sugeridos para o atendente humano, re-ranqueados pelas últimas falas do
// cliente (mesma busca vetorial do RAG). Sem fala do cliente ainda, devolve
// os artigos padrão.
sessionsRouter.get("/:id/suggestions", requireAuth, h(async (req, res) => {
  const { id } = req.params;
  const msgs = await pool.query(
    `SELECT conteudo FROM mensagem WHERE sessao_id = $1 AND remetente = 'cliente' ORDER BY timestamp DESC LIMIT 3`,
    [id]
  );
  const contexto = msgs.rows.map((r) => r.conteudo).reverse().join(" ").trim() || null;

  const itens = contexto
    ? (
        await pool.query(
          `SELECT id, titulo, conteudo, categoria, embedding <-> $1 AS distancia
           FROM knowledge_base ORDER BY embedding <-> $1 LIMIT 4`,
          [`[${embed(contexto).join(",")}]`]
        )
      ).rows
    : (
        await pool.query(
          `SELECT id, titulo, conteudo, categoria, NULL AS distancia FROM knowledge_base ORDER BY titulo LIMIT 4`
        )
      ).rows;

  res.json({ contexto, itens });
}));

// POST /v1/sessions/:id/messages — usado pelo Orquestrador para registrar
// a mensagem do cliente e a resposta do Vox
sessionsRouter.post("/:id/messages", validateBody(mensagemSchema), h(async (req, res) => {
  const { id } = req.params;
  const { remetente, canal, conteudo } = req.body;
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
sessionsRouter.post("/:id/intencao", validateBody(intencaoSchema), h(async (req, res) => {
  const { id } = req.params;
  const { mensagem_id, categoria, subcategoria, confianca, tom_emocional, jornada_status } = req.body;
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
