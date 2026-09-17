import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db";
import { h } from "../asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { validateBody, validateQuery } from "../validate";
import { hashCpf } from "../crypto";
import { broadcast } from "../ws";

export const fraudeRouter = Router();

// Camada de detecção de fraude cross-canal, exclusiva do admin (mesmo RBAC
// de Métricas/Atendentes). Três regras, três níveis de confiança — nunca um
// score único opaco (ver alerta_fraude no schema, e a Seção "Camada de
// Fraude" da documentação). O motor em si (as três regras, o scan
// incremental e o agrupamento em casos) vive em fraudeDeteccao.ts — este
// arquivo só tem os handlers HTTP, que NUNCA disparam o motor: ele só roda
// pelo job periódico (jobs/deteccaoFraude.ts), pra abrir/recarregar a aba
// nunca pagar o custo de reavaliar a base inteira.
//   A — volume de linhas pré-pagas no mesmo CPF (determinístico, alta)
//   B — dispositivo/IP compartilhado entre clientes de CPFs diferentes
//       (determinístico, alta)
//   C — similaridade de estilo de escrita entre clientes de CPFs diferentes
//       (probabilístico, baixa — nunca deve bloquear sozinho, só investigar)
fraudeRouter.use(requireAuth, requireRole("admin"));

const atualizarAlertaSchema = z
  .object({
    status: z.enum(["revisado", "descartado"], { errorMap: () => ({ message: "status deve ser 'revisado' ou 'descartado'" }) }),
    nota: z.string().trim().optional(),
  })
  .refine((dados) => dados.status !== "revisado" || !!dados.nota, {
    message: "nota é obrigatória para marcar como revisado — descreva o que foi investigado",
    path: ["nota"],
  });

const filtroSchema = z.object({
  regra: z.enum(["A_volume_cpf", "B_dispositivo_ip", "C_estilo_escrita"]).optional(),
  confianca: z.enum(["alta", "media", "baixa"]).optional(),
  desde: z.string().trim().min(1).optional(),
  ate: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).optional(),
  cpf: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const filtroHistoricoSchema = filtroSchema.extend({
  cursor: z.string().trim().min(1).optional(),
});

const filtroCasosSchema = filtroSchema.extend({
  status: z.enum(["aberto", "em_investigacao", "revisado", "descartado"]).optional(),
});

type Filtros = z.infer<typeof filtroSchema>;

// Monta os fragmentos WHERE compartilhados pelos filtros server-side (regra,
// confiança, período, CPF/nome do cliente) — usados tanto por /alertas
// quanto por /alertas/historico e /casos, cada um com seu próprio alias de
// tabela e coluna de data (criado_em vs. resolvido_em).
function construirFiltros(filtros: Filtros, params: unknown[], colunaData: string, prefixo = ""): string {
  const cond: string[] = [];
  if (filtros.regra) {
    params.push(filtros.regra);
    cond.push(`${prefixo}regra = $${params.length}`);
  }
  if (filtros.confianca) {
    params.push(filtros.confianca);
    cond.push(`${prefixo}confianca = $${params.length}`);
  }
  if (filtros.desde) {
    params.push(filtros.desde);
    cond.push(`${colunaData} >= $${params.length}::date`);
  }
  if (filtros.ate) {
    params.push(filtros.ate);
    cond.push(`${colunaData} < ($${params.length}::date + interval '1 day')`);
  }
  if (filtros.cpf) {
    params.push(hashCpf(filtros.cpf.replace(/\D/g, "")));
    cond.push(`EXISTS (SELECT 1 FROM cliente cl WHERE cl.id = ANY(${prefixo}clientes_ids) AND cl.cpf_hash = $${params.length})`);
  }
  if (filtros.q) {
    params.push(`%${filtros.q}%`);
    cond.push(`EXISTS (SELECT 1 FROM cliente cl WHERE cl.id = ANY(${prefixo}clientes_ids) AND cl.nome ILIKE $${params.length})`);
  }
  return cond.length ? `AND ${cond.join(" AND ")}` : "";
}

function codificarCursor(resolvidoEm: string, id: string): string {
  return Buffer.from(JSON.stringify({ r: resolvidoEm, i: id })).toString("base64url");
}

function decodificarCursor(cursor: string): { r: string; i: string } | null {
  try {
    const obj = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof obj?.r === "string" && typeof obj?.i === "string") return obj;
  } catch {
    // cursor inválido/adulterado — tratado como ausente (primeira página)
  }
  return null;
}

// Se o alerta resolvido era o último em aberto do seu caso, o caso também
// sai da fila de investigação — sem isso, um caso "concluído" continuava
// aparecendo como aberto/em investigação na aba Casos.
async function fecharCasoSeVazio(casoId: string | null | undefined, status: "revisado" | "descartado"): Promise<void> {
  if (!casoId) return;
  const restantes = await pool.query(`SELECT 1 FROM alerta_fraude WHERE caso_id = $1 AND status = 'aberto' LIMIT 1`, [casoId]);
  if (restantes.rows.length) return;
  await pool.query(`UPDATE caso_fraude SET status = $1, atualizado_em = now() WHERE id = $2`, [status, casoId]);
}

// GET /v1/fraude/alertas — leitura pura (não dispara o motor de detecção,
// ver comentário no topo do arquivo), com filtro/paginação server-side. A
// fila aberta usa um `limit` simples (mesmo padrão de clientes.ts) em vez de
// cursor: se ela crescer descontroladamente isso é sinal de ajustar limiar
// de configuração, não um problema de paginação.
fraudeRouter.get("/alertas", validateQuery(filtroSchema), h(async (req, res) => {
  const filtros = req.query as unknown as Filtros;
  const params: unknown[] = [];
  const filtroExtra = construirFiltros(filtros, params, "criado_em");
  params.push(filtros.limit || 100);

  const result = await pool.query(
    `SELECT id, regra, clientes_ids, evidencia, explicacao, confianca, status, criado_em, caso_id
     FROM alerta_fraude
     WHERE status = 'aberto' ${filtroExtra}
     ORDER BY (confianca = 'alta') DESC, (confianca = 'media') DESC, criado_em DESC
     LIMIT $${params.length}`,
    params
  );
  res.json(result.rows);
}));

// GET /v1/fraude/alertas/historico — cresce sem limite pra sempre (nada
// nunca sai de "revisado"/"descartado"), então é o único lugar da API que
// justifica paginação por cursor de verdade (keyset em resolvido_em+id) em
// vez do padrão de limit simples usado no resto do app.
fraudeRouter.get("/alertas/historico", validateQuery(filtroHistoricoSchema), h(async (req, res) => {
  const filtros = req.query as unknown as z.infer<typeof filtroHistoricoSchema>;
  const params: unknown[] = [];
  const filtroExtra = construirFiltros(filtros, params, "resolvido_em");

  let filtroCursor = "";
  if (filtros.cursor) {
    const decodificado = decodificarCursor(filtros.cursor);
    if (decodificado) {
      params.push(decodificado.r, decodificado.i);
      filtroCursor = `AND (resolvido_em, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
  }
  const limit = filtros.limit || 50;
  params.push(limit);

  const result = await pool.query(
    `SELECT id, regra, clientes_ids, evidencia, explicacao, confianca, status, criado_em,
            resolvido_em, resolvido_por, nota_resolucao, caso_id
     FROM alerta_fraude
     WHERE status IN ('revisado', 'descartado') ${filtroExtra} ${filtroCursor}
     ORDER BY resolvido_em DESC, id DESC
     LIMIT $${params.length}`,
    params
  );
  const ultimo = result.rows[result.rows.length - 1];
  const proximo_cursor = result.rows.length === limit && ultimo ? codificarCursor(ultimo.resolvido_em, ultimo.id) : null;
  res.json({ itens: result.rows, proximo_cursor });
}));

// PUT /v1/fraude/alertas/:id — marca um alerta individual como revisado ou
// descartado. Marcar como revisado exige uma nota descrevendo o que foi
// investigado — nunca um clique sem justificativa.
fraudeRouter.put("/alertas/:id", validateBody(atualizarAlertaSchema), h(async (req, res) => {
  const { status, nota } = req.body;
  const result = await pool.query(
    `UPDATE alerta_fraude SET status = $1, resolvido_em = now(), resolvido_por = $2, nota_resolucao = $3
     WHERE id = $4 RETURNING id, status, caso_id`,
    [status, req.usuario!.email, nota || null, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ erro: "alerta não encontrado" });
  await audit(req.usuario!.email, `fraude.alerta.${status}`, req.params.id);
  await fecharCasoSeVazio(result.rows[0].caso_id, status);
  broadcast("fraude.alerta.atualizado", { id: req.params.id, status });
  res.json(result.rows[0]);
}));

// GET /v1/fraude/casos — fila de triagem: um caso agrupa todos os alertas
// (de qualquer regra) que citam clientes em comum, já que investigar 5
// alertas quase idênticos como 5 casos separados não escala com o tamanho
// do time de analistas. Sem `status` explícito, devolve só o que ainda
// precisa de atenção (aberto/em investigação) — histórico de casos
// resolvidos fica em /alertas/historico (nível de alerta, mais granular).
fraudeRouter.get("/casos", validateQuery(filtroCasosSchema), h(async (req, res) => {
  const filtros = req.query as unknown as z.infer<typeof filtroCasosSchema>;
  const params: unknown[] = [];
  const statusCond = filtros.status
    ? (() => {
        params.push(filtros.status);
        return `cf.status = $${params.length}`;
      })()
    : `cf.status IN ('aberto', 'em_investigacao')`;
  const filtroAlerta = construirFiltros(filtros, params, "af.criado_em", "af.");
  params.push(filtros.limit || 50);

  const casosRes = await pool.query(
    `SELECT cf.id, cf.status, cf.analista_id, cf.assumido_em, cf.criado_em, cf.atualizado_em
     FROM caso_fraude cf
     WHERE ${statusCond}
       AND EXISTS (SELECT 1 FROM alerta_fraude af WHERE af.caso_id = cf.id ${filtroAlerta})
     ORDER BY cf.criado_em DESC
     LIMIT $${params.length}`,
    params
  );
  if (!casosRes.rows.length) return res.json([]);

  const casoIds = casosRes.rows.map((r) => r.id);
  const alertasRes = await pool.query(
    `SELECT id, regra, clientes_ids, evidencia, explicacao, confianca, status, criado_em, caso_id
     FROM alerta_fraude WHERE caso_id = ANY($1::uuid[]) ORDER BY (confianca = 'alta') DESC, criado_em DESC`,
    [casoIds]
  );
  const alertasPorCaso = new Map<string, typeof alertasRes.rows>();
  alertasRes.rows.forEach((a) => {
    if (!alertasPorCaso.has(a.caso_id)) alertasPorCaso.set(a.caso_id, []);
    alertasPorCaso.get(a.caso_id)!.push(a);
  });

  const todosClienteIds = [...new Set(alertasRes.rows.flatMap((a) => a.clientes_ids as string[]))];
  const bloqueados = new Set<string>();
  if (todosClienteIds.length) {
    const bloqueadosRes = await pool.query(`SELECT id FROM cliente WHERE id = ANY($1::uuid[]) AND bloqueado = true`, [
      todosClienteIds,
    ]);
    bloqueadosRes.rows.forEach((r) => bloqueados.add(r.id));
  }

  const ordemConfianca: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
  const resultado = casosRes.rows.map((c) => {
    const alertas = alertasPorCaso.get(c.id) || [];
    const clientes_ids = [...new Set(alertas.flatMap((a) => a.clientes_ids as string[]))];
    const maior_confianca = alertas.reduce(
      (melhor, a) => (ordemConfianca[a.confianca] < ordemConfianca[melhor] ? a.confianca : melhor),
      "baixa"
    );
    return { ...c, clientes_ids, maior_confianca, alertas, bloqueados: clientes_ids.filter((id) => bloqueados.has(id)) };
  });
  res.json(resultado);
}));

// PUT /v1/fraude/casos/:id — ação em lote: resolve de uma vez todos os
// alertas em aberto do caso com uma única nota compartilhada, em vez do
// analista precisar repetir a mesma decisão alerta por alerta.
fraudeRouter.put("/casos/:id", validateBody(atualizarAlertaSchema), h(async (req, res) => {
  const { status, nota } = req.body;
  const alertasRes = await pool.query(
    `UPDATE alerta_fraude SET status = $1, resolvido_em = now(), resolvido_por = $2, nota_resolucao = $3
     WHERE caso_id = $4 AND status = 'aberto' RETURNING id`,
    [status, req.usuario!.email, nota || null, req.params.id]
  );
  const casoRes = await pool.query(
    `UPDATE caso_fraude SET status = $1, atualizado_em = now() WHERE id = $2 RETURNING id, status`,
    [status, req.params.id]
  );
  if (!casoRes.rows.length) return res.status(404).json({ erro: "caso não encontrado" });
  await Promise.all(alertasRes.rows.map((a) => audit(req.usuario!.email, `fraude.alerta.${status}`, a.id)));
  await audit(req.usuario!.email, `fraude.caso.${status}`, req.params.id);
  broadcast("fraude.alerta.atualizado", { caso_id: req.params.id, status });
  res.json({ ...casoRes.rows[0], alertas_resolvidos: alertasRes.rows.length });
}));

// POST /v1/fraude/casos/:id/assumir — reivindica a investigação, no mesmo
// modelo de confiança de handoff.ts: o analista é sempre quem está logado
// (nunca um valor vindo do corpo). Diferente de handoff.ts, aqui a
// reivindicação é travada (409) se já pertence a outro analista — duas
// pessoas investigando (e possivelmente bloqueando/desbloqueando clientes
// de) o mesmo caso é mais arriscado que duas pessoas respondendo o mesmo chat.
fraudeRouter.post("/casos/:id/assumir", h(async (req, res) => {
  const analistaNome = req.usuario!.nome;
  const casoRes = await pool.query(`SELECT id, status, analista_id FROM caso_fraude WHERE id = $1`, [req.params.id]);
  if (!casoRes.rows.length) return res.status(404).json({ erro: "caso não encontrado" });
  const caso = casoRes.rows[0];
  if (caso.analista_id && caso.analista_id !== analistaNome) {
    return res
      .status(409)
      .json({ erro: "caso_ja_assumido", mensagem: `Este caso já está sendo investigado por ${caso.analista_id}.` });
  }
  const result = await pool.query(
    `UPDATE caso_fraude SET analista_id = $1, assumido_em = now(), status = 'em_investigacao', atualizado_em = now()
     WHERE id = $2 RETURNING id, status, analista_id, assumido_em`,
    [analistaNome, req.params.id]
  );
  await audit(req.usuario!.email, "fraude.caso.assumido", req.params.id);
  broadcast("fraude.caso.assumido", { caso_id: req.params.id, analista_id: analistaNome });
  res.json(result.rows[0]);
}));

// POST /v1/fraude/casos/:id/liberar — desiste da investigação (só quem
// assumiu pode liberar), devolvendo o caso pra fila.
fraudeRouter.post("/casos/:id/liberar", h(async (req, res) => {
  const casoRes = await pool.query(`SELECT id, analista_id FROM caso_fraude WHERE id = $1`, [req.params.id]);
  if (!casoRes.rows.length) return res.status(404).json({ erro: "caso não encontrado" });
  if (casoRes.rows[0].analista_id !== req.usuario!.nome) {
    return res.status(403).json({ erro: "só quem assumiu o caso pode liberá-lo" });
  }
  const result = await pool.query(
    `UPDATE caso_fraude SET analista_id = NULL, assumido_em = NULL, status = 'aberto', atualizado_em = now()
     WHERE id = $1 RETURNING id, status, analista_id`,
    [req.params.id]
  );
  await audit(req.usuario!.email, "fraude.caso.liberado", req.params.id);
  broadcast("fraude.caso.liberado", { caso_id: req.params.id });
  res.json(result.rows[0]);
}));

interface NoGrafo {
  id: string;
  nome: string;
  tipo: "cliente" | "linha";
  bloqueado?: boolean;
}

interface ArestaGrafo {
  id: string;
  origem: string;
  destino: string;
  alerta_id: string;
  regra: string;
  confianca: string;
  explicacao: string;
}

const TETO_NOS_GRAFO = 200;

// GET /v1/fraude/casos/:id/grafo — grafo por caso, não mais um grafo global
// de todos os alertas em aberto: já que um caso é por definição um
// componente conexo, isso naturalmente limita o grafo à vizinhança de UMA
// investigação, em vez de crescer com o total de alertas abertos no sistema
// inteiro. A Regra A também vira 1 nó-resumo por cliente (não 1 por linha —
// o detalhe completo dos protocolos já está na evidência do alerta).
fraudeRouter.get("/casos/:id/grafo", h(async (req, res) => {
  const alertasRes = await pool.query(
    `SELECT id, regra, clientes_ids, evidencia, explicacao, confianca FROM alerta_fraude WHERE caso_id = $1`,
    [req.params.id]
  );
  if (!alertasRes.rows.length) return res.json({ nos: [], arestas: [], truncado: false });

  const clienteIds = new Set<string>();
  alertasRes.rows.forEach((a) => a.clientes_ids.forEach((id: string) => clienteIds.add(id)));

  const nomes = new Map<string, string>();
  const bloqueados = new Set<string>();
  if (clienteIds.size) {
    const nomesRes = await pool.query(`SELECT id, nome, bloqueado FROM cliente WHERE id = ANY($1::uuid[])`, [
      [...clienteIds],
    ]);
    nomesRes.rows.forEach((r) => {
      nomes.set(r.id, r.nome);
      if (r.bloqueado) bloqueados.add(r.id);
    });
  }

  let nos: NoGrafo[] = [...clienteIds].map((id) => ({
    id,
    nome: nomes.get(id) || "cliente removido",
    tipo: "cliente",
    bloqueado: bloqueados.has(id),
  }));
  const arestas: ArestaGrafo[] = [];

  for (const a of alertasRes.rows) {
    if (a.regra === "A_volume_cpf") {
      const clienteId: string = a.clientes_ids[0];
      const protocolos: string[] = a.evidencia?.protocolos || [];
      const resumoId = `${clienteId}-linhas-resumo`;
      if (!nos.some((n) => n.id === resumoId)) {
        nos.push({ id: resumoId, nome: `${protocolos.length} linhas pré-pagas`, tipo: "linha" });
      }
      arestas.push({
        id: `${a.id}-resumo`,
        origem: clienteId,
        destino: resumoId,
        alerta_id: a.id,
        regra: a.regra,
        confianca: a.confianca,
        explicacao: a.explicacao,
      });
      continue;
    }

    const ids: string[] = a.clientes_ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        arestas.push({
          id: `${a.id}-${i}-${j}`,
          origem: ids[i],
          destino: ids[j],
          alerta_id: a.id,
          regra: a.regra,
          confianca: a.confianca,
          explicacao: a.explicacao,
        });
      }
    }
  }

  const truncado = nos.length > TETO_NOS_GRAFO;
  if (truncado) nos = nos.slice(0, TETO_NOS_GRAFO);
  const idsFinais = new Set(nos.map((n) => n.id));
  const arestasFinais = arestas.filter((a) => idsFinais.has(a.origem) && idsFinais.has(a.destino));

  res.json({ nos, arestas: arestasFinais, truncado });
}));
