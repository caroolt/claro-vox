import { Router } from "express";
import { pool } from "../db";
import { h } from "../asyncHandler";

export const metricsRouter = Router();

// GET /v1/metrics — versão simplificada do dashboard de SLO (Seção 7 / 8 da
// documentação técnica). Em produção esses números vêm do Grafana; aqui são
// calculados diretamente do Postgres para a demonstração do MVP.
metricsRouter.get("/", h(async (_req, res) => {
  const [sessoes, transbordo, tomEmocional, mensagens] = await Promise.all([
    pool.query(`SELECT estado, COUNT(*) FROM sessao GROUP BY estado`),
    // A taxa de transbordo mede a fração de sessões que EM ALGUM MOMENTO
    // precisaram de um atendente humano (existe um registro em `briefing`
    // para a sessão) — não apenas as que estão com esse estado agora. Usar
    // o estado atual da sessão faz a taxa "zerar" sempre que o atendente
    // encerra um atendimento (a sessão volta para ENCERRADA), escondendo
    // transbordos que já aconteceram e foram resolvidos.
    pool.query(`
      SELECT
        (SELECT COUNT(DISTINCT sessao_id) FROM briefing) AS transbordos,
        (SELECT COUNT(*) FROM sessao) AS total
    `),
    pool.query(`SELECT tom_emocional, COUNT(*) FROM intencao WHERE tom_emocional IS NOT NULL GROUP BY tom_emocional`),
    pool.query(`SELECT COUNT(*) AS total_mensagens FROM mensagem`),
  ]);

  const porEstado: Record<string, number> = {};
  sessoes.rows.forEach((r) => (porEstado[r.estado] = Number(r.count)));

  const total = Number(transbordo.rows[0]?.total || 0);
  const transbordos = Number(transbordo.rows[0]?.transbordos || 0);
  const taxaTransbordo = total > 0 ? Math.round((transbordos / total) * 1000) / 10 : 0;

  const tons: Record<string, number> = {};
  tomEmocional.rows.forEach((r) => (tons[r.tom_emocional] = Number(r.count)));

  res.json({
    sessoes_por_estado: porEstado,
    taxa_transbordo_pct: taxaTransbordo,
    tom_emocional: tons,
    total_mensagens: Number(mensagens.rows[0]?.total_mensagens || 0),
    disponibilidade_slo_pct: 99.5,
    latencia_p95_alvo_ms: 3000,
  });
}));
