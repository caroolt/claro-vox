import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db";
import { hashCpf } from "../crypto";
import { h } from "../asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { validateBody } from "../validate";

export const clientesRouter = Router();

const bloqueioSchema = z.object({
  bloqueado: z.boolean({ invalid_type_error: "bloqueado deve ser true ou false" }),
  motivo: z.string().trim().max(500).optional(),
});

// Marcador de exclusão LGPD (art. 18) — também usado em fraude.ts pra
// excluir clientes anonimizados do motor de detecção (não faz sentido
// gerar alerta sobre alguém que já não dá mais pra identificar).
export const NOME_ANONIMIZADO = "[excluído a pedido do titular]";

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

// GET /v1/clientes/alertas?ids=<id1,id2,...>: alertas de comportamento para
// a fila de transbordo (Operação). Tendência a hostilidade/urgência com base
// no tom das mensagens já classificadas, e quantos transbordos esse cliente
// abriu nos últimos 7 dias (usado para priorizar a fila). Precisa vir antes
// de "/:id" para não ser capturada por esse parâmetro.
const MIN_MENSAGENS_TAGEADAS = 3;
const LIMIAR_TENDENCIA = 0.4;
const LIMIAR_PRIORIDADE = 3;

clientesRouter.get("/alertas", requireAuth, h(async (req, res) => {
  const ids = String(req.query.ids || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const idsUnicos = [...new Set(ids)];
  if (!idsUnicos.length) return res.json([]);

  const [tomRes, chamadosRes] = await Promise.all([
    pool.query(
      `
      SELECT s.cliente_id, i.tom_emocional, COUNT(*) AS total
      FROM intencao i
      JOIN mensagem m ON m.id = i.mensagem_id
      JOIN sessao s ON s.id = m.sessao_id
      WHERE s.cliente_id = ANY($1::uuid[]) AND i.tom_emocional IS NOT NULL
      GROUP BY s.cliente_id, i.tom_emocional
    `,
      [idsUnicos]
    ),
    pool.query(
      `
      SELECT s.cliente_id, COUNT(*) AS total
      FROM briefing b
      JOIN sessao s ON s.id = b.sessao_id
      WHERE s.cliente_id = ANY($1::uuid[]) AND b.gerado_em >= now() - interval '7 days'
      GROUP BY s.cliente_id
    `,
      [idsUnicos]
    ),
  ]);

  const tonsPorCliente = new Map<string, Record<string, number>>();
  tomRes.rows.forEach((r) => {
    const atual = tonsPorCliente.get(r.cliente_id) || {};
    atual[r.tom_emocional] = Number(r.total);
    tonsPorCliente.set(r.cliente_id, atual);
  });

  const chamadosPorCliente = new Map<string, number>();
  chamadosRes.rows.forEach((r) => chamadosPorCliente.set(r.cliente_id, Number(r.total)));

  const alertas = idsUnicos.map((clienteId) => {
    const tons = tonsPorCliente.get(clienteId) || {};
    const totalTageado = Object.values(tons).reduce((soma, n) => soma + n, 0);
    const amostraSuficiente = totalTageado >= MIN_MENSAGENS_TAGEADAS;
    const hostil = amostraSuficiente && (tons.hostil || 0) / totalTageado >= LIMIAR_TENDENCIA;
    const urgente = amostraSuficiente && (tons.urgencia || 0) / totalTageado >= LIMIAR_TENDENCIA;
    const chamados_semana = chamadosPorCliente.get(clienteId) || 0;
    return {
      cliente_id: clienteId,
      hostil,
      urgente,
      chamados_semana,
      prioridade: chamados_semana >= LIMIAR_PRIORIDADE,
    };
  });

  res.json(alertas);
}));

// GET /v1/clientes/:id — dossiê completo do cliente para o drawer de detalhe.
clientesRouter.get("/:id", requireAuth, h(async (req, res) => {
  const { id } = req.params;
  const clienteRes = await pool.query("SELECT * FROM cliente WHERE id = $1", [id]);
  if (!clienteRes.rows.length) return res.status(404).json({ erro: "cliente não encontrado" });
  const cliente = clienteRes.rows[0];

  const [acess, sessoesRes, briefingsRes, npsRes, tomRes, msgCount, fraudeRes, fraudeAlertasRes] = await Promise.all([
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
    // Mesmo critério usado na fila de transbordo (handoff.ts) e no motor de
    // fraude (fraude.ts): alerta em aberto e de confiança alta — indício
    // forte o bastante pra chamar atenção do atendente aqui no dossiê, sem
    // repetir os indícios fracos da Regra C que pedem investigação, não alarme.
    pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM alerta_fraude WHERE $1 = ANY(clientes_ids) AND status = 'aberto' AND confianca = 'alta'
       ) AS possivel_fraude`,
      [id]
    ),
    // Histórico de fraude deste cliente para o drawer de dossiê (visível
    // tanto pro admin quanto pro atendente, ao contrário da aba Fraude em
    // si, que é exclusiva do admin) — todo alerta que já mencionou esse
    // cliente, aberto ou já resolvido/descartado, mais recente primeiro.
    pool.query(
      `SELECT id, regra, clientes_ids, evidencia, explicacao, confianca, status, criado_em,
              resolvido_em, resolvido_por, nota_resolucao
       FROM alerta_fraude
       WHERE $1 = ANY(clientes_ids)
       ORDER BY criado_em DESC`,
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
      bloqueado: cliente.bloqueado,
      bloqueado_em: cliente.bloqueado_em,
      bloqueado_motivo: cliente.bloqueado_motivo,
      possivel_fraude: fraudeRes.rows[0]?.possivel_fraude || false,
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
    fraude_alertas: fraudeAlertasRes.rows,
  });
}));

// PUT /v1/clientes/:id/bloqueio — ação de baixo atrito a partir de um
// alerta de fraude (aba Fraude): bloqueia (ou desbloqueia) o cliente sem
// apagar nada do histórico, ao contrário da exclusão LGPD abaixo. Um
// cliente bloqueado não consegue confirmar novas contratações (ver
// checagem em POST /v1/contratos).
clientesRouter.put("/:id/bloqueio", requireAuth, requireRole("admin"), validateBody(bloqueioSchema), h(async (req, res) => {
  const { id } = req.params;
  const { bloqueado, motivo } = req.body;

  const result = await pool.query(
    `UPDATE cliente
     SET bloqueado = $1, bloqueado_em = CASE WHEN $1 THEN now() ELSE NULL END,
         bloqueado_motivo = CASE WHEN $1 THEN $2 ELSE NULL END
     WHERE id = $3
     RETURNING id, nome, bloqueado, bloqueado_em, bloqueado_motivo`,
    [bloqueado, motivo || null, id]
  );
  if (!result.rows.length) return res.status(404).json({ erro: "cliente não encontrado" });

  await audit(req.usuario!.email, bloqueado ? "clientes.bloqueado" : "clientes.desbloqueado", id);
  res.json(result.rows[0]);
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
  // Descarta qualquer alerta de fraude em aberto que já mencione esse
  // cliente — não tem mais como investigar ou bloquear alguém que a gente
  // não sabe mais quem é, manter o alerta aberto só teria custo, nenhum
  // benefício.
  await pool.query(
    `UPDATE alerta_fraude SET status = 'descartado' WHERE $1 = ANY(clientes_ids) AND status = 'aberto'`,
    [id]
  );
  await audit("civ", "lgpd.exclusao", id);
  res.json({ ok: true, mensagem: "Dados do titular anonimizados conforme art. 18 da LGPD." });
}));
