import { Router } from "express";
import { pool, audit } from "../db";
import { h } from "../asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { extrairPerfilEstilo, similaridadeGeral, similaridadePorFeature, PerfilEstilo } from "../stylometria";
import { NOME_ANONIMIZADO } from "./clientes";
import { broadcast } from "../ws";

export const fraudeRouter = Router();

// Camada de detecção de fraude cross-canal, exclusiva do admin (mesmo RBAC
// de Métricas/Atendentes). Três regras, três níveis de confiança — nunca um
// score único opaco (ver alerta_fraude no schema, e a Seção "Camada de
// Fraude" da documentação):
//   A — volume de linhas pré-pagas no mesmo CPF (determinístico, alta)
//   B — dispositivo/IP compartilhado entre clientes de CPFs diferentes
//       (determinístico, alta)
//   C — similaridade de estilo de escrita entre clientes de CPFs diferentes
//       (probabilístico, baixa — nunca deve bloquear sozinho, só investigar)
fraudeRouter.use(requireAuth, requireRole("admin"));

const MIN_MENSAGENS_ESTILO = 3;

async function configValor(chave: string, padrao: number): Promise<number> {
  const r = await pool.query("SELECT valor FROM configuracao WHERE chave = $1", [chave]);
  return r.rows.length ? Number(r.rows[0].valor) : padrao;
}

interface AlertaGerado {
  regra: "A_volume_cpf" | "B_dispositivo_ip" | "C_estilo_escrita";
  clientes_ids: string[];
  evidencia: Record<string, unknown>;
  explicacao: string;
  confianca: "alta" | "media" | "baixa";
}

async function detectarRegraA(limiar: number): Promise<AlertaGerado[]> {
  const r = await pool.query(
    `
    SELECT c.cliente_id, cl.nome, COUNT(*) AS total, array_agg(c.protocolo) AS protocolos
    FROM contrato c JOIN cliente cl ON cl.id = c.cliente_id
    WHERE c.tipo_plano = 'pre-pago' AND c.status = 'confirmado' AND cl.nome <> $2
    GROUP BY c.cliente_id, cl.nome
    HAVING COUNT(*) > $1
  `,
    [limiar, NOME_ANONIMIZADO]
  );
  return r.rows.map((row) => ({
    regra: "A_volume_cpf" as const,
    clientes_ids: [row.cliente_id],
    evidencia: {
      clientes: [{ id: row.cliente_id, nome: row.nome }],
      total_linhas_pre_pago: Number(row.total),
      protocolos: row.protocolos,
      limiar,
    },
    explicacao: `${row.nome} tem ${row.total} linhas pré-pagas confirmadas no próprio CPF, acima do limite configurado de ${limiar}.`,
    confianca: "alta" as const,
  }));
}

async function detectarRegraB(): Promise<AlertaGerado[]> {
  // O JOIN com cliente (em vez de só filtrar por s.cliente_id IS NOT NULL)
  // tira da contagem quem já foi anonimizado por exclusão LGPD (art. 18) —
  // não faz sentido gerar ou manter um alerta sobre alguém que a gente não
  // sabe mais quem é. Não usa cpf_hash IS NOT NULL aqui porque isso também
  // excluiria clientes em prospecção de verdade (ainda sem CPF, não é o
  // mesmo caso).
  const [dispositivos, ips] = await Promise.all([
    pool.query(
      `
      SELECT s.dispositivo_id AS chave, array_agg(DISTINCT s.cliente_id) AS clientes
      FROM sessao s JOIN cliente cl ON cl.id = s.cliente_id AND cl.nome <> $1
      WHERE s.dispositivo_id IS NOT NULL
      GROUP BY s.dispositivo_id HAVING COUNT(DISTINCT s.cliente_id) > 1
    `,
      [NOME_ANONIMIZADO]
    ),
    pool.query(
      `
      SELECT s.ip_origem AS chave, array_agg(DISTINCT s.cliente_id) AS clientes
      FROM sessao s JOIN cliente cl ON cl.id = s.cliente_id AND cl.nome <> $1
      WHERE s.ip_origem IS NOT NULL
      GROUP BY s.ip_origem HAVING COUNT(DISTINCT s.cliente_id) > 1
    `,
      [NOME_ANONIMIZADO]
    ),
  ]);

  const clienteIds = new Set<string>();
  [...dispositivos.rows, ...ips.rows].forEach((r) => r.clientes.forEach((id: string) => clienteIds.add(id)));
  const nomes = new Map<string, string>();
  if (clienteIds.size) {
    const nomesRes = await pool.query(`SELECT id, nome FROM cliente WHERE id = ANY($1::uuid[])`, [[...clienteIds]]);
    nomesRes.rows.forEach((r) => nomes.set(r.id, r.nome));
  }

  const alertas: AlertaGerado[] = [];
  for (const row of dispositivos.rows) {
    const ids = [...row.clientes].sort();
    const clientes = ids.map((id) => ({ id, nome: nomes.get(id) || id }));
    alertas.push({
      regra: "B_dispositivo_ip",
      clientes_ids: ids,
      evidencia: { tipo: "dispositivo_id", valor: row.chave, clientes },
      explicacao: `O mesmo dispositivo foi usado por ${ids.length} CPFs diferentes: ${clientes.map((c) => c.nome).join(", ")}.`,
      confianca: "alta",
    });
  }
  for (const row of ips.rows) {
    const ids = [...row.clientes].sort();
    const clientes = ids.map((id) => ({ id, nome: nomes.get(id) || id }));
    alertas.push({
      regra: "B_dispositivo_ip",
      clientes_ids: ids,
      evidencia: { tipo: "ip_origem", valor: row.chave, clientes },
      explicacao: `A mesma origem de rede (IP) foi usada por ${ids.length} CPFs diferentes: ${clientes.map((c) => c.nome).join(", ")}.`,
      confianca: "alta",
    });
  }
  return alertas;
}

// LIMITAÇÃO CONHECIDA: compara cada cliente com todos os outros (par a
// par), custo O(n²) no número de clientes com mensagens suficientes. Viável
// para a base de demonstração, mas não escala para uma base de produção
// (milhões de clientes) — precisaria de uma etapa de bucketing/clustering
// antes (só comparar dentro de grupos com características parecidas) ou
// rodar como job em lote, não sob demanda a cada GET.
async function detectarRegraC(limiar: number): Promise<AlertaGerado[]> {
  const r = await pool.query(
    `
    SELECT s.cliente_id, cl.nome, array_agg(m.conteudo) AS mensagens
    FROM mensagem m JOIN sessao s ON s.id = m.sessao_id JOIN cliente cl ON cl.id = s.cliente_id
    WHERE m.remetente = 'cliente' AND s.cliente_id IS NOT NULL AND cl.nome <> $2
    GROUP BY s.cliente_id, cl.nome
    HAVING COUNT(*) >= $1
  `,
    [MIN_MENSAGENS_ESTILO, NOME_ANONIMIZADO]
  );

  const perfis: { clienteId: string; nome: string; perfil: PerfilEstilo }[] = [];
  for (const row of r.rows) {
    const perfil = extrairPerfilEstilo(row.mensagens);
    if (perfil) perfis.push({ clienteId: row.cliente_id, nome: row.nome, perfil });
  }

  const alertas: AlertaGerado[] = [];
  for (let i = 0; i < perfis.length; i++) {
    for (let j = i + 1; j < perfis.length; j++) {
      const a = perfis[i];
      const b = perfis[j];
      const similaridade = similaridadeGeral(a.perfil, b.perfil);
      if (similaridade < limiar) continue;
      const porFeature = similaridadePorFeature(a.perfil, b.perfil);
      const nomePorId = new Map([[a.clienteId, a.nome], [b.clienteId, b.nome]]);
      const ids = [a.clienteId, b.clienteId].sort();
      const clientes = ids.map((id) => ({ id, nome: nomePorId.get(id)! }));
      alertas.push({
        regra: "C_estilo_escrita",
        clientes_ids: ids,
        evidencia: {
          clientes,
          similaridade_geral: Number(similaridade.toFixed(2)),
          por_feature: Object.fromEntries(
            Object.entries(porFeature).map(([k, v]) => [k, Number((v as number).toFixed(2))])
          ),
        },
        explicacao: `${a.nome} e ${b.nome} têm padrão de escrita ${Math.round(similaridade * 100)}% semelhante, apesar de CPFs diferentes. Indício fraco, requer investigação manual.`,
        confianca: "baixa",
      });
    }
  }
  return alertas;
}

// Upsert idempotente: um alerta em aberto com a mesma regra + mesmo
// conjunto de clientes é atualizado (não duplicado) a cada nova checagem.
// Devolve se um alerta NOVO foi criado (diferente de só atualizar a
// evidência de um já existente) — usado para decidir quando vale a pena
// avisar os painéis conectados via WebSocket, sem gerar ruído a cada
// checagem periódica que não encontrou nada novo.
async function upsertAlerta(a: AlertaGerado): Promise<boolean> {
  const existente = await pool.query(
    `SELECT id FROM alerta_fraude WHERE regra = $1 AND clientes_ids = $2::uuid[] AND status = 'aberto'`,
    [a.regra, a.clientes_ids]
  );
  if (existente.rows.length) {
    await pool.query(`UPDATE alerta_fraude SET evidencia = $1, explicacao = $2, criado_em = now() WHERE id = $3`, [
      JSON.stringify(a.evidencia),
      a.explicacao,
      existente.rows[0].id,
    ]);
    return false;
  }
  await pool.query(
    `INSERT INTO alerta_fraude (regra, clientes_ids, evidencia, explicacao, confianca) VALUES ($1, $2::uuid[], $3, $4, $5)`,
    [a.regra, a.clientes_ids, JSON.stringify(a.evidencia), a.explicacao, a.confianca]
  );
  return true;
}

// Roda as três regras e grava/atualiza alerta_fraude (idempotente) —
// reaproveitada tanto pelo GET /alertas (sob demanda, quando o painel de
// fraude está aberto) quanto pelo job periódico (deteccaoFraude.ts), que
// garante que alertas novos apareçam em tempo real via WebSocket mesmo que
// ninguém esteja com a aba de Fraude aberta no momento em que a fraude
// acontece. Devolve true se algum alerta novo foi criado (e, nesse caso,
// já avisa os painéis conectados).
export async function executarDeteccaoFraude(): Promise<boolean> {
  const [limiarA, limiarC] = await Promise.all([
    configValor("limiar_fraude_pre_pago", 3),
    configValor("limiar_similaridade_estilo", 0.85),
  ]);

  const [alertasA, alertasB, alertasC] = await Promise.all([
    detectarRegraA(limiarA),
    detectarRegraB(),
    detectarRegraC(limiarC),
  ]);

  let houveAlertaNovo = false;
  for (const a of [...alertasA, ...alertasB, ...alertasC]) {
    const novo = await upsertAlerta(a);
    if (novo) houveAlertaNovo = true;
  }
  if (houveAlertaNovo) broadcast("fraude.alerta.criado", {});
  return houveAlertaNovo;
}

// GET /v1/fraude/alertas — roda a detecção sob demanda e devolve os
// alertas em aberto, mais confiantes primeiro.
fraudeRouter.get("/alertas", h(async (_req, res) => {
  await executarDeteccaoFraude();

  const result = await pool.query(`
    SELECT id, regra, clientes_ids, evidencia, explicacao, confianca, status, criado_em
    FROM alerta_fraude
    WHERE status = 'aberto'
    ORDER BY (confianca = 'alta') DESC, (confianca = 'media') DESC, criado_em DESC
  `);
  res.json(result.rows);
}));

// GET /v1/fraude/alertas/historico — alertas já revisados/descartados, mais
// recentes primeiro. Fica numa aba separada dos alertas em aberto pra não
// misturar o que ainda precisa de atenção com o que já foi resolvido —
// nunca é recalculado (ao contrário de /alertas, que roda o motor de
// detecção), só lê o que já foi decidido.
fraudeRouter.get("/alertas/historico", h(async (_req, res) => {
  const result = await pool.query(`
    SELECT id, regra, clientes_ids, evidencia, explicacao, confianca, status, criado_em,
           resolvido_em, resolvido_por, nota_resolucao
    FROM alerta_fraude
    WHERE status IN ('revisado', 'descartado')
    ORDER BY resolvido_em DESC NULLS LAST, criado_em DESC
    LIMIT 200
  `);
  res.json(result.rows);
}));

// PUT /v1/fraude/alertas/:id — atendente/admin marca um alerta como
// revisado (investigado e confirmado) ou descartado (falso positivo).
// Marcar como revisado exige uma nota descrevendo o que foi investigado —
// nunca um clique sem justificativa, já que essa decisão sai do alerta em
// aberto e vira histórico. Fica registrado em auditoria — parte da trilha
// auditável (XAI).
fraudeRouter.put("/alertas/:id", h(async (req, res) => {
  const { status, nota } = req.body || {};
  if (!["revisado", "descartado"].includes(status)) {
    return res.status(400).json({ erro: "status deve ser 'revisado' ou 'descartado'" });
  }
  if (status === "revisado" && !String(nota || "").trim()) {
    return res.status(400).json({ erro: "nota é obrigatória para marcar como revisado — descreva o que foi investigado" });
  }
  const result = await pool.query(
    `UPDATE alerta_fraude SET status = $1, resolvido_em = now(), resolvido_por = $2, nota_resolucao = $3
     WHERE id = $4 RETURNING id, status`,
    [status, req.usuario!.email, nota ? String(nota).trim() : null, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ erro: "alerta não encontrado" });
  await audit(req.usuario!.email, `fraude.alerta.${status}`, req.params.id);
  broadcast("fraude.alerta.atualizado", { id: req.params.id, status });
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

// GET /v1/fraude/grafo — nós/arestas só dos clientes envolvidos em alertas
// em aberto (nunca a base inteira) para o grafo do painel (react-flow).
// A Regra A também vira arestas: cada linha pré-paga do cliente aparece
// como um nó satélite conectado a ele, pra mostrar o leque de contas de
// verdade em vez de só marcar o cliente com uma borda.
fraudeRouter.get("/grafo", h(async (_req, res) => {
  const alertasRes = await pool.query(
    `SELECT id, regra, clientes_ids, evidencia, explicacao, confianca FROM alerta_fraude WHERE status = 'aberto'`
  );

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

  const nos: NoGrafo[] = [...clienteIds].map((id) => ({
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
      protocolos.forEach((protocolo, i) => {
        const linhaId = `${a.id}-linha-${i}`;
        nos.push({ id: linhaId, nome: `Linha ${protocolo}`, tipo: "linha" });
        arestas.push({
          id: `${a.id}-aresta-${i}`,
          origem: clienteId,
          destino: linhaId,
          alerta_id: a.id,
          regra: a.regra,
          confianca: a.confianca,
          explicacao: a.explicacao,
        });
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

  res.json({ nos, arestas });
}));
