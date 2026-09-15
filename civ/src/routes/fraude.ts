import { Router } from "express";
import { pool, audit } from "../db";
import { h } from "../asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { extrairPerfilEstilo, similaridadeGeral, similaridadePorFeature, PerfilEstilo } from "../stylometria";

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
    WHERE c.tipo_plano = 'pre-pago' AND c.status = 'confirmado'
    GROUP BY c.cliente_id, cl.nome
    HAVING COUNT(*) > $1
  `,
    [limiar]
  );
  return r.rows.map((row) => ({
    regra: "A_volume_cpf" as const,
    clientes_ids: [row.cliente_id],
    evidencia: {
      cliente_nome: row.nome,
      total_linhas_pre_pago: Number(row.total),
      protocolos: row.protocolos,
      limiar,
    },
    explicacao: `${row.nome} tem ${row.total} linhas pré-pagas confirmadas no próprio CPF, acima do limite configurado de ${limiar}.`,
    confianca: "alta" as const,
  }));
}

async function detectarRegraB(): Promise<AlertaGerado[]> {
  const [dispositivos, ips] = await Promise.all([
    pool.query(`
      SELECT s.dispositivo_id AS chave, array_agg(DISTINCT s.cliente_id) AS clientes
      FROM sessao s WHERE s.dispositivo_id IS NOT NULL AND s.cliente_id IS NOT NULL
      GROUP BY s.dispositivo_id HAVING COUNT(DISTINCT s.cliente_id) > 1
    `),
    pool.query(`
      SELECT s.ip_origem AS chave, array_agg(DISTINCT s.cliente_id) AS clientes
      FROM sessao s WHERE s.ip_origem IS NOT NULL AND s.cliente_id IS NOT NULL
      GROUP BY s.ip_origem HAVING COUNT(DISTINCT s.cliente_id) > 1
    `),
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
    const nomesClientes = ids.map((id) => nomes.get(id) || id);
    alertas.push({
      regra: "B_dispositivo_ip",
      clientes_ids: ids,
      evidencia: { tipo: "dispositivo_id", valor: row.chave, clientes: nomesClientes },
      explicacao: `O mesmo dispositivo foi usado por ${ids.length} CPFs diferentes: ${nomesClientes.join(", ")}.`,
      confianca: "alta",
    });
  }
  for (const row of ips.rows) {
    const ids = [...row.clientes].sort();
    const nomesClientes = ids.map((id) => nomes.get(id) || id);
    alertas.push({
      regra: "B_dispositivo_ip",
      clientes_ids: ids,
      evidencia: { tipo: "ip_origem", valor: row.chave, clientes: nomesClientes },
      explicacao: `A mesma origem de rede (IP) foi usada por ${ids.length} CPFs diferentes: ${nomesClientes.join(", ")}.`,
      confianca: "alta",
    });
  }
  return alertas;
}

async function detectarRegraC(limiar: number): Promise<AlertaGerado[]> {
  const r = await pool.query(
    `
    SELECT s.cliente_id, cl.nome, array_agg(m.conteudo) AS mensagens
    FROM mensagem m JOIN sessao s ON s.id = m.sessao_id JOIN cliente cl ON cl.id = s.cliente_id
    WHERE m.remetente = 'cliente' AND s.cliente_id IS NOT NULL
    GROUP BY s.cliente_id, cl.nome
    HAVING COUNT(*) >= $1
  `,
    [MIN_MENSAGENS_ESTILO]
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
      const ids = [a.clienteId, b.clienteId].sort();
      alertas.push({
        regra: "C_estilo_escrita",
        clientes_ids: ids,
        evidencia: {
          clientes: [a.nome, b.nome],
          similaridade_geral: Number(similaridade.toFixed(2)),
          por_feature: Object.fromEntries(
            Object.entries(porFeature).map(([k, v]) => [k, Number((v as number).toFixed(2))])
          ),
        },
        explicacao: `${a.nome} e ${b.nome} têm padrão de escrita ${Math.round(similaridade * 100)}% semelhante, apesar de CPFs diferentes — indício fraco, requer investigação manual.`,
        confianca: "baixa",
      });
    }
  }
  return alertas;
}

// Upsert idempotente: um alerta em aberto com a mesma regra + mesmo
// conjunto de clientes é atualizado (não duplicado) a cada nova checagem.
async function upsertAlerta(a: AlertaGerado) {
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
    return;
  }
  await pool.query(
    `INSERT INTO alerta_fraude (regra, clientes_ids, evidencia, explicacao, confianca) VALUES ($1, $2::uuid[], $3, $4, $5)`,
    [a.regra, a.clientes_ids, JSON.stringify(a.evidencia), a.explicacao, a.confianca]
  );
}

// GET /v1/fraude/alertas — roda as três regras sob demanda, grava/atualiza
// alerta_fraude (idempotente) e devolve os alertas em aberto, mais
// confiantes primeiro.
fraudeRouter.get("/alertas", h(async (_req, res) => {
  const [limiarA, limiarC] = await Promise.all([
    configValor("limiar_fraude_pre_pago", 3),
    configValor("limiar_similaridade_estilo", 0.85),
  ]);

  const [alertasA, alertasB, alertasC] = await Promise.all([
    detectarRegraA(limiarA),
    detectarRegraB(),
    detectarRegraC(limiarC),
  ]);

  for (const a of [...alertasA, ...alertasB, ...alertasC]) {
    await upsertAlerta(a);
  }

  const result = await pool.query(`
    SELECT id, regra, clientes_ids, evidencia, explicacao, confianca, status, criado_em
    FROM alerta_fraude
    WHERE status = 'aberto'
    ORDER BY (confianca = 'alta') DESC, (confianca = 'media') DESC, criado_em DESC
  `);
  res.json(result.rows);
}));

// PUT /v1/fraude/alertas/:id — atendente/admin marca um alerta como
// revisado (investigado e confirmado) ou descartado (falso positivo).
// Fica registrado em auditoria — parte da trilha auditável (XAI).
fraudeRouter.put("/alertas/:id", h(async (req, res) => {
  const { status } = req.body || {};
  if (!["revisado", "descartado"].includes(status)) {
    return res.status(400).json({ erro: "status deve ser 'revisado' ou 'descartado'" });
  }
  const result = await pool.query(`UPDATE alerta_fraude SET status = $1 WHERE id = $2 RETURNING id, status`, [
    status,
    req.params.id,
  ]);
  if (!result.rows.length) return res.status(404).json({ erro: "alerta não encontrado" });
  await audit(req.usuario!.email, `fraude.alerta.${status}`, req.params.id);
  res.json(result.rows[0]);
}));

// GET /v1/fraude/grafo — nós/arestas só dos clientes envolvidos em alertas
// em aberto (nunca a base inteira) para o grafo do painel (react-flow).
fraudeRouter.get("/grafo", h(async (_req, res) => {
  const alertasRes = await pool.query(
    `SELECT id, regra, clientes_ids, evidencia, explicacao, confianca FROM alerta_fraude WHERE status = 'aberto'`
  );

  const clienteIds = new Set<string>();
  alertasRes.rows.forEach((a) => a.clientes_ids.forEach((id: string) => clienteIds.add(id)));

  const nomes = new Map<string, string>();
  if (clienteIds.size) {
    const nomesRes = await pool.query(`SELECT id, nome FROM cliente WHERE id = ANY($1::uuid[])`, [[...clienteIds]]);
    nomesRes.rows.forEach((r) => nomes.set(r.id, r.nome));
  }

  const nos = [...clienteIds].map((id) => ({ id, nome: nomes.get(id) || "cliente removido" }));

  // A Regra A é interna a um único cliente (não liga identidades
  // diferentes) — vira destaque no próprio nó, não uma aresta.
  const alertasVolume = alertasRes.rows.filter((a) => a.regra === "A_volume_cpf");
  const arestas = alertasRes.rows
    .filter((a) => a.regra !== "A_volume_cpf")
    .flatMap((a) => {
      const ids: string[] = a.clientes_ids;
      const pares: {
        id: string;
        origem: string;
        destino: string;
        alerta_id: string;
        regra: string;
        confianca: string;
        explicacao: string;
      }[] = [];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          pares.push({
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
      return pares;
    });

  res.json({ nos, arestas, alertas_volume: alertasVolume });
}));
