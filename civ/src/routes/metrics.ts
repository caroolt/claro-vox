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
    pool.query(`SELECT COUNT(*) FILTER (WHERE estado IN ('TRANSBORDO_PENDENTE','EM_ATENDIMENTO_HUMANO')) AS transbordos, COUNT(*) AS total FROM sessao`),
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
