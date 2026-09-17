import { Router } from "express";
import { pool } from "../db";
import { h } from "../asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";

export const metricsRouter = Router();

// GET /v1/metrics — versão simplificada do dashboard de SLO (Seção 7 / 8 da
// documentação técnica). Em produção esses números vêm do Grafana; aqui são
// calculados diretamente do Postgres para a demonstração do MVP.
// Só a aba "Visão geral" usa essa rota, e ela é exclusiva da role admin.
//
// Filtro de data opcional (`desde`/`ate`, YYYY-MM-DD): quando os dois vêm
// preenchidos, todos os indicadores são recalculados só com o período — o
// painel manda o mês corrente por padrão, mas sem os dois parâmetros a rota
// segue devolvendo a base inteira (compatibilidade com quem chamar sem
// filtro).
metricsRouter.get("/", requireAuth, requireRole("admin"), h(async (req, res) => {
  const desde = typeof req.query.desde === "string" ? req.query.desde : null;
  const ate = typeof req.query.ate === "string" ? req.query.ate : null;
  const temPeriodo = Boolean(desde && ate);
  const periodoParams = temPeriodo ? [desde, ate] : [];
  // Intervalo meio-aberto [desde, ate+1dia) pra incluir o dia inteiro de
  // `ate`, já que a coluna é timestamptz (meia-noite de `ate` sozinha ia
  // cortar fora o dia todo).
  const filtro = (coluna: string) =>
    temPeriodo ? `${coluna} >= $1::date AND ${coluna} < ($2::date + interval '1 day')` : "TRUE";

  const [sessoes, transbordo, tomEmocional, mensagens, porCanal, npsRows, fraude] = await Promise.all([
    pool.query(`SELECT estado, COUNT(*) FROM sessao WHERE ${filtro("criado_em")} GROUP BY estado`, periodoParams),
    // A taxa de transbordo mede a fração de sessões que EM ALGUM MOMENTO
    // precisaram de um atendente humano (existe um registro em `briefing`
    // para a sessão) — não apenas as que estão com esse estado agora. Usar
    // o estado atual da sessão faz a taxa "zerar" sempre que o atendente
    // encerra um atendimento (a sessão volta para ENCERRADA), escondendo
    // transbordos que já aconteceram e foram resolvidos.
    pool.query(
      `
      SELECT
        (SELECT COUNT(DISTINCT b.sessao_id) FROM briefing b JOIN sessao s ON s.id = b.sessao_id WHERE ${filtro("s.criado_em")}) AS transbordos,
        (SELECT COUNT(*) FROM sessao WHERE ${filtro("criado_em")}) AS total
    `,
      periodoParams
    ),
    pool.query(
      `
      SELECT i.tom_emocional, COUNT(*) FROM intencao i
      JOIN mensagem m ON m.id = i.mensagem_id
      WHERE i.tom_emocional IS NOT NULL AND ${filtro("m.timestamp")}
      GROUP BY i.tom_emocional
    `,
      periodoParams
    ),
    pool.query(`SELECT COUNT(*) AS total_mensagens FROM mensagem WHERE ${filtro("timestamp")}`, periodoParams),
    // Distribuição por canal de origem — alimenta o gráfico de canais do
    // Vox Briefing (RF001/RF004: mesma jornada, canais diferentes).
    pool.query(
      `
      SELECT ca.nome AS canal, COUNT(*) AS total
      FROM sessao s JOIN canal ca ON ca.id = s.canal_origem_id
      WHERE ${filtro("s.criado_em")}
      GROUP BY ca.nome
    `,
      periodoParams
    ),
    // NPS por alvo (IA × atendente humano): média geral das notas, total de
    // respostas e o índice NPS clássico (% promotores 9-10 − % detratores 0-6).
    pool.query(
      `
      SELECT
        alvo,
        AVG(nota)::numeric(4,1)                                   AS media,
        COUNT(*)                                                  AS respostas,
        COUNT(*) FILTER (WHERE nota >= 9)                         AS promotores,
        COUNT(*) FILTER (WHERE nota <= 6)                         AS detratores
      FROM nps
      WHERE ${filtro("criado_em")}
      GROUP BY alvo
    `,
      periodoParams
    ),
    // % de fraude: fração das sessões do período cujo cliente tem, hoje, um
    // alerta de fraude em aberto de alta confiança (mesmo critério do flag
    // "possível fraude" da fila de transbordo/dossiê — ver handoff.ts).
    pool.query(
      `
      SELECT COUNT(DISTINCT s.id) AS sessoes_fraude
      FROM sessao s JOIN cliente cl ON cl.id = s.cliente_id
      WHERE ${filtro("s.criado_em")} AND EXISTS (
        SELECT 1 FROM alerta_fraude af
        WHERE cl.id = ANY(af.clientes_ids) AND af.status = 'aberto' AND af.confianca = 'alta'
      )
    `,
      periodoParams
    ),
  ]);

  const porEstado: Record<string, number> = {};
  sessoes.rows.forEach((r) => (porEstado[r.estado] = Number(r.count)));

  const total = Number(transbordo.rows[0]?.total || 0);
  const transbordos = Number(transbordo.rows[0]?.transbordos || 0);
  const taxaTransbordo = total > 0 ? Math.round((transbordos / total) * 1000) / 10 : 0;

  const sessoesFraude = Number(fraude.rows[0]?.sessoes_fraude || 0);
  const taxaFraude = total > 0 ? Math.round((sessoesFraude / total) * 1000) / 10 : 0;

  const tons: Record<string, number> = {};
  tomEmocional.rows.forEach((r) => (tons[r.tom_emocional] = Number(r.count)));

  const canais: Record<string, number> = {};
  porCanal.rows.forEach((r) => (canais[r.canal] = Number(r.total)));

  const npsVazio = () => ({ media: 0, respostas: 0, indice: 0 });
  const nps: Record<"ia" | "atendente", { media: number; respostas: number; indice: number }> = {
    ia: npsVazio(),
    atendente: npsVazio(),
  };
  npsRows.rows.forEach((r) => {
    const respostas = Number(r.respostas);
    const alvo = r.alvo as "ia" | "atendente";
    if (alvo !== "ia" && alvo !== "atendente") return;
    nps[alvo] = {
      media: Number(r.media) || 0,
      respostas,
      indice: respostas > 0 ? Math.round(((Number(r.promotores) - Number(r.detratores)) / respostas) * 100) : 0,
    };
  });

  res.json({
    sessoes_por_estado: porEstado,
    taxa_transbordo_pct: taxaTransbordo,
    tom_emocional: tons,
    total_mensagens: Number(mensagens.rows[0]?.total_mensagens || 0),
    taxa_fraude_pct: taxaFraude,
    sessoes_por_canal: canais,
    total_sessoes: total,
    total_transbordos: transbordos,
    total_sessoes_fraude: sessoesFraude,
    nps,
  });
}));
