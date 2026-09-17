// fraudeDeteccao.ts — motor de detecção de fraude cross-canal, extraído de
// routes/fraude.ts para que a rota fique só com os handlers HTTP. Pensado
// para uma base de clientes muito maior que a de demonstração: nenhuma das
// três regras varre a base inteira a cada ciclo (ver cada função abaixo).
//
//   A — volume de linhas pré-pagas no mesmo CPF (determinístico, alta)
//   B — dispositivo/IP compartilhado entre clientes de CPFs diferentes
//       (determinístico, alta) — incremental via watermark em sessao.atualizado_em
//   C — similaridade de estilo de escrita entre clientes de CPFs diferentes
//       (probabilístico, baixa) — incremental via watermark em mensagem.timestamp
//       + bucketing (nunca compara todo mundo com todo mundo)
import { pool, audit } from "./db";
import { broadcast } from "./ws";
import { extrairPerfilEstilo, similaridadeGeral, similaridadePorFeature, PerfilEstilo } from "./stylometria";
import { NOME_ANONIMIZADO } from "./routes/clientes";
import { localizarIp, formatarLocalizacao } from "./geoip";

const MIN_MENSAGENS_ESTILO = 3;

async function configValor(chave: string, padrao: number): Promise<number> {
  const r = await pool.query("SELECT valor FROM configuracao WHERE chave = $1", [chave]);
  return r.rows.length ? Number(r.rows[0].valor) : padrao;
}

export interface AlertaGerado {
  regra: "A_volume_cpf" | "B_dispositivo_ip" | "C_estilo_escrita";
  clientes_ids: string[];
  evidencia: Record<string, unknown>;
  explicacao: string;
  confianca: "alta" | "media" | "baixa";
}

// Identidade de um alerta = o conjunto de clientes que ele cita, não a ordem
// em que apareceram — usado tanto pro upsert idempotente quanto pra saber
// quais alertas antigos deixaram de bater com o critério atual.
function chaveClientes(ids: string[]): string {
  return [...ids].sort().join(",");
}

// Resultado de uma regra: além dos alertas gerados, o conjunto de "chaves"
// (grupos de clientes) que foram de fato reavaliadas nesta rodada —
// necessário pra reconciliação (fecharAlertasObsoletos) nunca fechar um
// alerta que simplesmente não entrou no escopo incremental desta vez.
interface ResultadoRegra {
  gerados: AlertaGerado[];
  chavesAvaliadas: Set<string>;
  // Regra B apenas: valores brutos de dispositivo_id/ip_origem tocados desde
  // a última rodada — permite escopar a reconciliação por SQL direto (WHERE
  // evidencia->>'valor' = ANY(...)) em vez de carregar todo alerta aberto.
  evidenciaValoresTocados?: string[];
}

async function obterWatermark(regra: "B_dispositivo_ip" | "C_estilo_escrita"): Promise<Date> {
  const r = await pool.query(`SELECT ultimo_scan_em FROM fraude_scan_estado WHERE regra = $1`, [regra]);
  return r.rows.length ? r.rows[0].ultimo_scan_em : new Date(0);
}

async function avancarWatermark(
  regra: "B_dispositivo_ip" | "C_estilo_escrita",
  quando: Date,
  parametro?: number
): Promise<void> {
  await pool.query(
    `INSERT INTO fraude_scan_estado (regra, ultimo_scan_em, ultimo_parametro) VALUES ($1, $2, $3)
     ON CONFLICT (regra) DO UPDATE SET ultimo_scan_em = $2,
       ultimo_parametro = COALESCE($3, fraude_scan_estado.ultimo_parametro)`,
    [regra, quando, parametro ?? null]
  );
}

// Regra A: scan completo a cada ciclo (sem HAVING no SQL — o limiar é
// aplicado aqui em JS) porque é barato: bounded pelo nº de contratos
// pré-pagos confirmados, não pela base de clientes inteira. Escanear por
// inteiro também é o que permite fechar sozinho um alerta antigo quando o
// admin sobe o limiar de configuração.
async function detectarRegraA(limiar: number): Promise<ResultadoRegra> {
  const r = await pool.query(
    `
    SELECT c.cliente_id, cl.nome, COUNT(*) AS total, array_agg(c.protocolo) AS protocolos
    FROM contrato c JOIN cliente cl ON cl.id = c.cliente_id
    WHERE c.tipo_plano = 'pre-pago' AND c.status = 'confirmado' AND cl.nome <> $1
    GROUP BY c.cliente_id, cl.nome
  `,
    [NOME_ANONIMIZADO]
  );

  const gerados: AlertaGerado[] = [];
  const chavesAvaliadas = new Set<string>();
  for (const row of r.rows) {
    chavesAvaliadas.add(chaveClientes([row.cliente_id]));
    if (Number(row.total) <= limiar) continue;
    gerados.push({
      regra: "A_volume_cpf",
      clientes_ids: [row.cliente_id],
      evidencia: {
        clientes: [{ id: row.cliente_id, nome: row.nome }],
        total_linhas_pre_pago: Number(row.total),
        protocolos: row.protocolos,
        limiar,
      },
      explicacao: `${row.nome} tem ${row.total} linhas pré-pagas confirmadas no próprio CPF, acima do limite configurado de ${limiar}.`,
      confianca: "alta",
    });
  }
  return { gerados, chavesAvaliadas };
}

// Regra B: incremental via watermark em sessao.atualizado_em — só reavalia
// os grupos de dispositivo_id/ip_origem que tiveram sessão nova/atualizada
// desde a última rodada, em vez de reagrupar a tabela sessao inteira a cada
// 60s. Sem limiar configurável, então nunca precisa de recomputo forçado.
async function detectarRegraB(): Promise<ResultadoRegra> {
  const desde = await obterWatermark("B_dispositivo_ip");
  const agora = new Date();

  const [dispTocadosRes, ipTocadosRes] = await Promise.all([
    pool.query(`SELECT DISTINCT dispositivo_id FROM sessao WHERE atualizado_em > $1 AND dispositivo_id IS NOT NULL`, [desde]),
    pool.query(`SELECT DISTINCT ip_origem FROM sessao WHERE atualizado_em > $1 AND ip_origem IS NOT NULL`, [desde]),
  ]);
  const dispositivosTocados: string[] = dispTocadosRes.rows.map((row) => row.dispositivo_id);
  const ipsTocados: string[] = ipTocadosRes.rows.map((row) => row.ip_origem);
  await avancarWatermark("B_dispositivo_ip", agora);

  const evidenciaValoresTocados = [...dispositivosTocados, ...ipsTocados];
  if (!evidenciaValoresTocados.length) {
    return { gerados: [], chavesAvaliadas: new Set(), evidenciaValoresTocados };
  }

  const [dispositivos, ips] = await Promise.all([
    dispositivosTocados.length
      ? pool.query(
          `SELECT s.dispositivo_id AS chave, array_agg(DISTINCT s.cliente_id) AS clientes
           FROM sessao s JOIN cliente cl ON cl.id = s.cliente_id AND cl.nome <> $2
           WHERE s.dispositivo_id = ANY($1)
           GROUP BY s.dispositivo_id`,
          [dispositivosTocados, NOME_ANONIMIZADO]
        )
      : Promise.resolve({ rows: [] as { chave: string; clientes: string[] }[] }),
    ipsTocados.length
      ? pool.query(
          `SELECT s.ip_origem AS chave, array_agg(DISTINCT s.cliente_id) AS clientes
           FROM sessao s JOIN cliente cl ON cl.id = s.cliente_id AND cl.nome <> $2
           WHERE s.ip_origem = ANY($1)
           GROUP BY s.ip_origem`,
          [ipsTocados, NOME_ANONIMIZADO]
        )
      : Promise.resolve({ rows: [] as { chave: string; clientes: string[] }[] }),
  ]);

  const idsComNome = new Set<string>();
  [...dispositivos.rows, ...ips.rows].forEach((row) => row.clientes.forEach((id) => idsComNome.add(id)));
  const nomes = new Map<string, string>();
  if (idsComNome.size) {
    const nomesRes = await pool.query(`SELECT id, nome FROM cliente WHERE id = ANY($1::uuid[])`, [[...idsComNome]]);
    nomesRes.rows.forEach((row) => nomes.set(row.id, row.nome));
  }

  const gerados: AlertaGerado[] = [];
  const chavesAvaliadas = new Set<string>();

  for (const row of dispositivos.rows) {
    const ids = [...row.clientes].sort();
    chavesAvaliadas.add(chaveClientes(ids));
    if (ids.length < 2) continue;
    const clientes = ids.map((id) => ({ id, nome: nomes.get(id) || id }));
    gerados.push({
      regra: "B_dispositivo_ip",
      clientes_ids: ids,
      evidencia: { tipo: "dispositivo_id", valor: row.chave, clientes },
      explicacao: `O mesmo dispositivo foi usado por ${ids.length} CPFs diferentes: ${clientes.map((c) => c.nome).join(", ")}.`,
      confianca: "alta",
    });
  }
  for (const row of ips.rows) {
    const ids = [...row.clientes].sort();
    chavesAvaliadas.add(chaveClientes(ids));
    if (ids.length < 2) continue;
    const clientes = ids.map((id) => ({ id, nome: nomes.get(id) || id }));
    const localizacao = formatarLocalizacao(localizarIp(row.chave));
    gerados.push({
      regra: "B_dispositivo_ip",
      clientes_ids: ids,
      evidencia: { tipo: "ip_origem", valor: row.chave, localizacao, clientes },
      explicacao: `A mesma origem de rede (IP) foi usada por ${ids.length} CPFs diferentes: ${clientes.map((c) => c.nome).join(", ")}.`,
      confianca: "alta",
    });
  }

  return { gerados, chavesAvaliadas, evidenciaValoresTocados };
}

// tamanho_medio_palavra e diversidade_lexical são as únicas duas features de
// PerfilEstilo que de fato discriminam entre pessoas reais (ver o comentário
// em stylometria.ts) — arredondadas a 1 casa, viram uma grade de 100 baldes.
// Só compara um cliente com quem está no mesmo balde ou nos 8 vizinhos,
// nunca com a base inteira.
function calcularBucket(perfil: PerfilEstilo): string {
  const q = (v: number) => Math.round(v * 10) / 10;
  return `${q(perfil.tamanho_medio_palavra)}|${q(perfil.diversidade_lexical)}`;
}

function bucketsVizinhos(bucket: string): string[] {
  const [a, b] = bucket.split("|").map(Number);
  const deltas = [-0.1, 0, 0.1];
  const vizinhos = new Set<string>();
  for (const da of deltas) {
    for (const db of deltas) {
      const na = Math.min(1, Math.max(0, Math.round((a + da) * 10) / 10));
      const nb = Math.min(1, Math.max(0, Math.round((b + db) * 10) / 10));
      vizinhos.add(`${na}|${nb}`);
    }
  }
  return [...vizinhos];
}

async function atualizarPerfilCliente(
  clienteId: string
): Promise<{ nome: string; perfil: PerfilEstilo; bucket: string } | null> {
  const r = await pool.query(
    `SELECT cl.nome, array_agg(m.conteudo) AS mensagens
     FROM mensagem m
     JOIN sessao s ON s.id = m.sessao_id
     JOIN cliente cl ON cl.id = s.cliente_id
     WHERE m.remetente = 'cliente' AND s.cliente_id = $1 AND cl.nome <> $2
     GROUP BY cl.nome
     HAVING COUNT(*) >= $3`,
    [clienteId, NOME_ANONIMIZADO, MIN_MENSAGENS_ESTILO]
  );
  if (!r.rows.length) {
    // Sem mensagens suficientes (ainda) ou cliente anonimizado — remove
    // qualquer perfil antigo, pra não sobrar comparação com quem não deve
    // mais entrar na Regra C.
    await pool.query(`DELETE FROM perfil_estilo_cliente WHERE cliente_id = $1`, [clienteId]);
    return null;
  }
  const perfil = extrairPerfilEstilo(r.rows[0].mensagens);
  if (!perfil) {
    await pool.query(`DELETE FROM perfil_estilo_cliente WHERE cliente_id = $1`, [clienteId]);
    return null;
  }
  const bucket = calcularBucket(perfil);
  await pool.query(
    `INSERT INTO perfil_estilo_cliente (cliente_id, perfil, bucket, atualizado_em) VALUES ($1, $2, $3, now())
     ON CONFLICT (cliente_id) DO UPDATE SET perfil = $2, bucket = $3, atualizado_em = now()`,
    [clienteId, JSON.stringify(perfil), bucket]
  );
  return { nome: r.rows[0].nome, perfil, bucket };
}

// Regra C: incremental via watermark em mensagem.timestamp — só recalcula o
// perfil de quem mandou mensagem nova desde a última rodada, e só compara
// contra o balde (ver acima). Exceção: se o limiar de similaridade mudou
// desde a última rodada, QUALQUER par já comparado pode ter mudado de
// veredito, então força reavaliar todo mundo que já tem perfil persistido
// — ainda barato, porque reaproveita os perfis já calculados (só refaz a
// comparação bucketizada, não a extração de estilo).
async function detectarRegraC(limiar: number): Promise<ResultadoRegra> {
  const [watermark, estadoRes] = await Promise.all([
    obterWatermark("C_estilo_escrita"),
    pool.query(`SELECT ultimo_parametro FROM fraude_scan_estado WHERE regra = 'C_estilo_escrita'`),
  ]);
  const ultimoLimiar = estadoRes.rows[0]?.ultimo_parametro;
  const limiarMudou = ultimoLimiar !== null && ultimoLimiar !== undefined && Number(ultimoLimiar) !== limiar;
  const agora = new Date();

  const mudados = limiarMudou ? null : await clientesComMensagemNovaDesde(watermark);
  if (!limiarMudou && mudados && !mudados.length) {
    await avancarWatermark("C_estilo_escrita", agora, limiar);
    return { gerados: [], chavesAvaliadas: new Set() };
  }

  if (mudados) {
    for (const clienteId of mudados) await atualizarPerfilCliente(clienteId);
  } else {
    // Recomputo completo de VEREDITO (não de perfil): garante que todo
    // cliente com mensagens suficientes tenha um perfil persistido, mesmo
    // alguém que nunca tinha sido avaliado antes de atingir o mínimo.
    const todos = await pool.query(
      `SELECT DISTINCT s.cliente_id
       FROM mensagem m JOIN sessao s ON s.id = m.sessao_id
       WHERE m.remetente = 'cliente' AND s.cliente_id IS NOT NULL`
    );
    for (const row of todos.rows) {
      const jaTemPerfil = await pool.query(`SELECT 1 FROM perfil_estilo_cliente WHERE cliente_id = $1`, [row.cliente_id]);
      if (!jaTemPerfil.rows.length) await atualizarPerfilCliente(row.cliente_id);
    }
  }

  const gerados: AlertaGerado[] = [];
  const chavesAvaliadas = new Set<string>();
  const paresAvaliados = new Set<string>();

  async function avaliarContraVizinhos(clienteId: string, nome: string, perfil: PerfilEstilo, bucket: string) {
    const vizinhancaRes = await pool.query(
      `SELECT pe.cliente_id, pe.perfil, cl.nome
       FROM perfil_estilo_cliente pe JOIN cliente cl ON cl.id = pe.cliente_id
       WHERE pe.bucket = ANY($1) AND pe.cliente_id <> $2 AND cl.nome <> $3`,
      [bucketsVizinhos(bucket), clienteId, NOME_ANONIMIZADO]
    );
    for (const vizinho of vizinhancaRes.rows) {
      const ids = [clienteId, vizinho.cliente_id].sort();
      const chave = chaveClientes(ids);
      if (paresAvaliados.has(chave)) continue;
      paresAvaliados.add(chave);
      chavesAvaliadas.add(chave);

      const perfilVizinho = vizinho.perfil as PerfilEstilo;
      const similaridade = similaridadeGeral(perfil, perfilVizinho);
      if (similaridade < limiar) continue;

      const porFeature = similaridadePorFeature(perfil, perfilVizinho);
      const nomePorId = new Map([[clienteId, nome], [vizinho.cliente_id, vizinho.nome]]);
      const clientes = ids.map((id) => ({ id, nome: nomePorId.get(id)! }));
      gerados.push({
        regra: "C_estilo_escrita",
        clientes_ids: ids,
        evidencia: {
          clientes,
          similaridade_geral: Number(similaridade.toFixed(2)),
          por_feature: Object.fromEntries(Object.entries(porFeature).map(([k, v]) => [k, Number((v as number).toFixed(2))])),
        },
        explicacao: `${nomePorId.get(ids[0])} e ${nomePorId.get(ids[1])} têm padrão de escrita ${Math.round(similaridade * 100)}% semelhante, apesar de CPFs diferentes. Indício fraco, requer investigação manual.`,
        confianca: "baixa",
      });
    }
  }

  if (mudados) {
    for (const clienteId of mudados) {
      const perfilRes = await pool.query(
        `SELECT pe.perfil, pe.bucket, cl.nome FROM perfil_estilo_cliente pe JOIN cliente cl ON cl.id = pe.cliente_id WHERE pe.cliente_id = $1`,
        [clienteId]
      );
      if (!perfilRes.rows.length) continue;
      const { perfil, bucket, nome } = perfilRes.rows[0];
      await avaliarContraVizinhos(clienteId, nome, perfil, bucket);
    }
  } else {
    const todosPerfis = await pool.query(
      `SELECT pe.cliente_id, pe.perfil, pe.bucket, cl.nome FROM perfil_estilo_cliente pe JOIN cliente cl ON cl.id = pe.cliente_id WHERE cl.nome <> $1`,
      [NOME_ANONIMIZADO]
    );
    for (const row of todosPerfis.rows) {
      await avaliarContraVizinhos(row.cliente_id, row.nome, row.perfil, row.bucket);
    }
  }

  await avancarWatermark("C_estilo_escrita", agora, limiar);
  return { gerados, chavesAvaliadas };
}

async function clientesComMensagemNovaDesde(desde: Date): Promise<string[]> {
  const r = await pool.query(
    `SELECT DISTINCT s.cliente_id
     FROM mensagem m JOIN sessao s ON s.id = m.sessao_id
     WHERE m.remetente = 'cliente' AND s.cliente_id IS NOT NULL AND m.timestamp > $1`,
    [desde]
  );
  return r.rows.map((row) => row.cliente_id);
}

// Fecha automaticamente alertas "aberto" que deixaram de bater com o
// critério atual — sem isso, um alerta antigo ficava preso pra sempre em
// "aberto" mesmo depois de, por exemplo, subir o limiar de similaridade da
// Regra C. Só reconsidera o que foi de fato reavaliado nesta rodada
// (chavesAvaliadas / evidenciaValoresTocados) — nunca fecha um alerta só
// porque ele ficou fora do escopo incremental desta vez. Nunca mexe em
// alertas já revisados/descartados por um humano.
async function fecharAlertasObsoletos(
  regra: AlertaGerado["regra"],
  chavesAvaliadas: Set<string>,
  chavesValidas: Set<string>,
  evidenciaValoresTocados?: string[]
): Promise<boolean> {
  if (evidenciaValoresTocados && !evidenciaValoresTocados.length) return false;

  const abertos = evidenciaValoresTocados
    ? await pool.query(
        `SELECT id, clientes_ids FROM alerta_fraude WHERE regra = $1 AND status = 'aberto' AND evidencia->>'valor' = ANY($2)`,
        [regra, evidenciaValoresTocados]
      )
    : await pool.query(`SELECT id, clientes_ids FROM alerta_fraude WHERE regra = $1 AND status = 'aberto'`, [regra]);

  const obsoletos = abertos.rows.filter((r) => {
    const chave = chaveClientes(r.clientes_ids);
    if (!chavesAvaliadas.has(chave)) return false;
    return !chavesValidas.has(chave);
  });
  if (!obsoletos.length) return false;

  const ids = obsoletos.map((r) => r.id);
  await pool.query(
    `UPDATE alerta_fraude SET status = 'descartado', resolvido_em = now(), resolvido_por = 'sistema',
       nota_resolucao = 'Fechado automaticamente: não atende mais aos critérios de detecção atuais.'
     WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  await Promise.all(ids.map((id) => audit("sistema", "fraude.alerta.fechado_automatico", id)));
  return true;
}

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

// Agrupa alertas em aberto que citam clientes em comum num único "caso"
// investigável (união por componentes conexos: dois alertas que citam o
// mesmo cliente, mesmo que por regras diferentes, pertencem ao mesmo caso).
// Recalculado do zero a cada ciclo sobre os alertas ABERTOS — o custo é
// proporcional ao nº de alertas em aberto (que o próprio design mantém
// pequeno), nunca ao nº de clientes da base.
export async function recomputarCasos(): Promise<void> {
  const abertos = await pool.query(`SELECT id, clientes_ids, caso_id FROM alerta_fraude WHERE status = 'aberto'`);
  if (!abertos.rows.length) return;

  const pai = new Map<string, string>();
  function raiz(x: string): string {
    if (!pai.has(x)) pai.set(x, x);
    let r = x;
    while (pai.get(r) !== r) r = pai.get(r) as string;
    pai.set(x, r);
    return r;
  }
  function unir(a: string, b: string) {
    const ra = raiz(a);
    const rb = raiz(b);
    if (ra !== rb) pai.set(ra, rb);
  }
  for (const row of abertos.rows) {
    const ids: string[] = row.clientes_ids;
    raiz(ids[0]);
    for (let i = 1; i < ids.length; i++) unir(ids[0], ids[i]);
  }

  const alertasPorComponente = new Map<string, typeof abertos.rows>();
  for (const row of abertos.rows) {
    const comp = raiz(row.clientes_ids[0]);
    if (!alertasPorComponente.has(comp)) alertasPorComponente.set(comp, []);
    alertasPorComponente.get(comp)!.push(row);
  }

  for (const alertasDoComponente of alertasPorComponente.values()) {
    const casosExistentes = [...new Set(alertasDoComponente.map((a) => a.caso_id).filter(Boolean))] as string[];

    let casoCanonico: string;
    if (casosExistentes.length === 0) {
      const novo = await pool.query(`INSERT INTO caso_fraude DEFAULT VALUES RETURNING id`);
      casoCanonico = novo.rows[0].id;
    } else if (casosExistentes.length === 1) {
      casoCanonico = casosExistentes[0];
    } else {
      // Duas investigações separadas se fundiram (um alerta novo liga
      // clientes que antes só apareciam em casos distintos) — prioriza o
      // caso já em investigação, pra não perder a atribuição de um analista.
      const infoRes = await pool.query(
        `SELECT id FROM caso_fraude WHERE id = ANY($1::uuid[]) ORDER BY (status = 'em_investigacao') DESC, criado_em ASC`,
        [casosExistentes]
      );
      casoCanonico = infoRes.rows[0].id;
      const extras = casosExistentes.filter((id) => id !== casoCanonico);
      await pool.query(`UPDATE alerta_fraude SET caso_id = $1 WHERE caso_id = ANY($2::uuid[])`, [casoCanonico, extras]);
      await pool.query(
        `DELETE FROM caso_fraude WHERE id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM alerta_fraude WHERE caso_id = caso_fraude.id)`,
        [extras]
      );
    }

    const idsParaAtualizar = alertasDoComponente.filter((a) => a.caso_id !== casoCanonico).map((a) => a.id);
    if (idsParaAtualizar.length) {
      await pool.query(`UPDATE alerta_fraude SET caso_id = $1 WHERE id = ANY($2::uuid[])`, [casoCanonico, idsParaAtualizar]);
    }
  }
}

// Roda as três regras, reconcilia alertas obsoletos, grava/atualiza
// alerta_fraude e recalcula o agrupamento em casos. Chamada só pelo job
// periódico (deteccaoFraude.ts) — GET /v1/fraude/alertas NÃO dispara mais
// isso (ver routes/fraude.ts), pra não pagar o custo da detecção a cada
// abertura da aba. Devolve true se algo mudou (novo alerta ou alerta
// fechado automaticamente), e nesse caso já avisa os painéis conectados.
export async function executarDeteccaoFraude(): Promise<boolean> {
  const [limiarA, limiarC] = await Promise.all([
    configValor("limiar_fraude_pre_pago", 3),
    configValor("limiar_similaridade_estilo", 0.85),
  ]);

  const [resultadoA, resultadoB, resultadoC] = await Promise.all([
    detectarRegraA(limiarA),
    detectarRegraB(),
    detectarRegraC(limiarC),
  ]);

  const porRegra: [AlertaGerado["regra"], ResultadoRegra][] = [
    ["A_volume_cpf", resultadoA],
    ["B_dispositivo_ip", resultadoB],
    ["C_estilo_escrita", resultadoC],
  ];

  let houveMudanca = false;
  for (const [regra, resultado] of porRegra) {
    const chavesValidas = new Set(resultado.gerados.map((a) => chaveClientes(a.clientes_ids)));
    const fechouAlgum = await fecharAlertasObsoletos(
      regra,
      resultado.chavesAvaliadas,
      chavesValidas,
      resultado.evidenciaValoresTocados
    );
    if (fechouAlgum) houveMudanca = true;
  }

  for (const [, resultado] of porRegra) {
    for (const a of resultado.gerados) {
      const novo = await upsertAlerta(a);
      if (novo) houveMudanca = true;
    }
  }

  await recomputarCasos();

  if (houveMudanca) broadcast("fraude.alerta.criado", {});
  return houveMudanca;
}
