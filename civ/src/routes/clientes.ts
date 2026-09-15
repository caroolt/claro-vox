import { Router } from "express";
import { pool, audit } from "../db";
import { hashCpf } from "../crypto";
import { h } from "../asyncHandler";
import { requireAuth } from "../middleware/auth";

export const clientesRouter = Router();

const NOME_ANONIMIZADO = "[excluído a pedido do titular]";

// GET /v1/clientes?q=<nome>&cpf=<cpf> — busca para o painel do atendente.
// `cpf` (11 dígitos) faz match exato pelo hash — nunca guardamos o número
// em texto puro (Seção 4.6). `q` faz busca parcial por nome ou telefone.
// Sem parâmetros, lista os clientes mais recentes.
clientesRouter.get("/", requireAuth, h(async (req, res) => {
  const q = String(req.query.q || "").trim();
  const cpf = String(req.query.cpf || "").replace(/\D/g, "");
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);

  const params: unknown[] = [];
  const filtros: string[] = [`cl.nome <> '${NOME_ANONIMIZADO}'`];

  if (cpf.length === 11) {
    params.push(hashCpf(cpf));
    filtros.push(`cl.cpf_hash = $${params.length}`);
  } else if (q) {
    params.push(`%${q}%`);
    filtros.push(`(cl.nome ILIKE $${params.length} OR cl.telefone ILIKE $${params.length})`);
  }

  const result = await pool.query(
    `
    SELECT cl.id, cl.nome, cl.tipo_cliente, cl.data_cadastro,
           (SELECT COUNT(*) FROM sessao s WHERE s.cliente_id = cl.id) AS total_sessoes,
           (SELECT COUNT(DISTINCT b.sessao_id)
              FROM briefing b JOIN sessao s ON s.id = b.sessao_id
             WHERE s.cliente_id = cl.id) AS total_transbordos,
           (SELECT MAX(s.atualizado_em) FROM sessao s WHERE s.cliente_id = cl.id) AS ultima_interacao
    FROM cliente cl
    WHERE ${filtros.join(" AND ")}
    ORDER BY ultima_interacao DESC NULLS LAST, cl.data_cadastro DESC
    LIMIT ${limit}
  `,
    params
  );

  res.json(
    result.rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      tipo_cliente: r.tipo_cliente,
      data_cadastro: r.data_cadastro,
      total_sessoes: Number(r.total_sessoes),
      total_transbordos: Number(r.total_transbordos),
      ultima_interacao: r.ultima_interacao,
    }))
  );
}));

// GET /v1/clientes/:id — dossiê completo do cliente para o drawer de detalhe.
clientesRouter.get("/:id", requireAuth, h(async (req, res) => {
  const { id } = req.params;
  const clienteRes = await pool.query("SELECT * FROM cliente WHERE id = $1", [id]);
  if (!clienteRes.rows.length) return res.status(404).json({ erro: "cliente não encontrado" });
  const cliente = clienteRes.rows[0];

  const [acess, sessoesRes, briefingsRes, npsRes, tomRes, msgCount] = await Promise.all([
    pool.query(
      `SELECT modalidade_libras, leitor_de_tela, linguagem_simplificada
       FROM preferencia_acessibilidade WHERE cliente_id = $1`,
      [id]
    ),
    pool.query(
      `
      SELECT s.id, s.estado, s.criado_em, s.atualizado_em, s.protocolo,
             ca.nome AS canal, ctx.ultima_intencao, ctx.jornada_status
      FROM sessao s
      LEFT JOIN canal ca ON ca.id = s.canal_origem_id
      LEFT JOIN contexto ctx ON ctx.sessao_id = s.id
      WHERE s.cliente_id = $1
      ORDER BY s.criado_em DESC
    `,
      [id]
    ),
    pool.query(
      `
      SELECT b.id, b.motivo_transbordo, b.tom_emocional, b.resumo_jornada,
             b.sugestao_resolucao, b.canais_utilizados, b.gerado_em,
             h.atendente_id, h.assumido_em, h.encerrado_em
      FROM briefing b
      JOIN sessao s ON s.id = b.sessao_id
      LEFT JOIN handoff h ON h.briefing_id = b.id
      WHERE s.cliente_id = $1
      ORDER BY b.gerado_em DESC
    `,
      [id]
    ),
    pool.query(
      `
      SELECT n.alvo, n.nota, n.comentario, n.criado_em
      FROM nps n JOIN sessao s ON s.id = n.sessao_id
      WHERE s.cliente_id = $1
      ORDER BY n.criado_em DESC
    `,
      [id]
    ),
    pool.query(
      `
      SELECT i.tom_emocional, COUNT(*) AS total
      FROM intencao i
      JOIN mensagem m ON m.id = i.mensagem_id
      JOIN sessao s ON s.id = m.sessao_id
      WHERE s.cliente_id = $1 AND i.tom_emocional IS NOT NULL
      GROUP BY i.tom_emocional
    `,
      [id]
    ),
    pool.query(
      `SELECT COUNT(*) AS total FROM mensagem m JOIN sessao s ON s.id = m.sessao_id WHERE s.cliente_id = $1`,
      [id]
    ),
  ]);

  const tom_emocional: Record<string, number> = {};
  tomRes.rows.forEach((r) => (tom_emocional[r.tom_emocional] = Number(r.total)));

  const nps: Record<"ia" | "atendente", { nota: number; comentario: string | null; criado_em: string } | null> = {
    ia: null,
    atendente: null,
  };
  npsRes.rows.forEach((r) => {
    const alvo = r.alvo as "ia" | "atendente";
    if ((alvo === "ia" || alvo === "atendente") && !nps[alvo]) {
      nps[alvo] = { nota: Number(r.nota), comentario: r.comentario, criado_em: r.criado_em };
    }
  });

  await audit("civ", "clientes.detalhe.read", id);

  res.json({
    cliente: {
      id: cliente.id,
      nome: cliente.nome,
      tipo_cliente: cliente.tipo_cliente,
      tem_cpf: !!cliente.cpf_hash,
      telefone: cliente.telefone,
      data_cadastro: cliente.data_cadastro,
      consentimento_ts: cliente.consentimento_ts,
      consentimento_versao: cliente.consentimento_versao,
    },
    acessibilidade:
      acess.rows[0] || { modalidade_libras: false, leitor_de_tela: false, linguagem_simplificada: false },
    resumo: {
      total_sessoes: sessoesRes.rowCount ?? 0,
      total_transbordos: briefingsRes.rowCount ?? 0,
      total_mensagens: Number(msgCount.rows[0]?.total || 0),
      ultima_interacao: sessoesRes.rows[0]?.atualizado_em || null,
    },
    nps,
    tom_emocional,
    sessoes: sessoesRes.rows,
    briefings: briefingsRes.rows,
  });
}));

// DELETE /v1/clientes/:id — direito de exclusão da LGPD (art. 18), Seção 4.7
clientesRouter.delete("/:id", h(async (req, res) => {
  const { id } = req.params;
  const cliente = await pool.query("SELECT id FROM cliente WHERE id = $1", [id]);
  if (!cliente.rows.length) return res.status(404).json({ erro: "cliente não encontrado" });

  await pool.query(
    `UPDATE cliente SET nome = '${NOME_ANONIMIZADO}', cpf_hash = NULL, telefone = NULL WHERE id = $1`,
    [id]
  );
  await pool.query(
    `UPDATE briefing SET resumo_jornada = '[anonimizado]' WHERE sessao_id IN (SELECT id FROM sessao WHERE cliente_id = $1)`,
    [id]
  );
  await audit("civ", "lgpd.exclusao", id);
  res.json({ ok: true, mensagem: "Dados do titular anonimizados conforme art. 18 da LGPD." });
}));
