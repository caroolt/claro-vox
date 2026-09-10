import type { Metrics } from "../../types";
import { CAT_HEX, CompareBars, Meter, StackedBar, STATUS_HEX } from "../charts";
import {
  CANAL_META,
  CANAL_ORDEM,
  ESTADO_META,
  ESTADO_ORDEM,
  montarSegmentos,
  TOM_META,
  TOM_ORDEM,
} from "./meta";
import { KpiCard } from "./ui";

const META_TRANSBORDO = 25;

export function VisaoGeralTab({
  metrics,
  sessoesAtivas,
  flash,
  onEstadoClick,
}: {
  metrics: Metrics | null;
  sessoesAtivas: number;
  flash: boolean;
  onEstadoClick: (estado: string) => void;
}) {
  if (!metrics) {
    return <p className="text-sm text-gray-400">Carregando indicadores…</p>;
  }

  const segmentosEstado = montarSegmentos(
    metrics.sessoes_por_estado,
    ESTADO_META,
    ESTADO_ORDEM,
    (_k, m) => STATUS_HEX[m?.status || "neutral"]
  );
  const segmentosTom = montarSegmentos(
    metrics.tom_emocional,
    TOM_META,
    TOM_ORDEM,
    (_k, m) => STATUS_HEX[m?.status || "neutral"]
  );
  const segmentosCanal = montarSegmentos(metrics.sessoes_por_canal, CANAL_META, CANAL_ORDEM, (k) => {
    const idx = CANAL_ORDEM.indexOf(k);
    return CAT_HEX[idx >= 0 ? idx : 0];
  });

  const acimaDaMeta = metrics.taxa_transbordo_pct > META_TRANSBORDO;
  const totalAvaliacoes = metrics.nps.ia.respostas + metrics.nps.atendente.respostas;

  return (
    <div className={`space-y-5 ${flash ? "vox-flash" : ""}`}>
      <section>
        <SecaoRotulo>Atendimento agora</SecaoRotulo>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Taxa de transbordo"
            value={`${metrics.taxa_transbordo_pct}%`}
            sub={`${metrics.total_transbordos}/${metrics.total_sessoes} sessões → humano`}
            destaque={acimaDaMeta}
          >
            <Meter pct={metrics.taxa_transbordo_pct} bom={20} critico={45} meta={META_TRANSBORDO} />
          </KpiCard>
          <KpiCard label="Sessões ativas" value={sessoesAtivas} sub="não encerradas" />
          <KpiCard label="Mensagens trocadas" value={metrics.total_mensagens} sub="cliente + Vox + atendente" />
          <KpiCard
            label="Disponibilidade (SLO)"
            value={`${metrics.disponibilidade_slo_pct}%`}
            sub={`p95 alvo ${metrics.latencia_p95_alvo_ms} ms`}
          />
        </div>
      </section>

      <section>
        <SecaoRotulo>Composição e satisfação</SecaoRotulo>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h4 className="text-sm font-medium text-gray-700">Composição das sessões</h4>
              <span className="text-[11px] text-gray-400">clique num estado para abrir a Operação filtrada</span>
            </div>
            <div className="divide-y divide-gray-100">
              <DistBloco titulo="Por estado">
                <StackedBar segments={segmentosEstado} onSelect={onEstadoClick} />
              </DistBloco>
              <DistBloco titulo="Por tom emocional">
                <StackedBar segments={segmentosTom} emptyLabel="Nenhuma mensagem classificada ainda" />
              </DistBloco>
              <DistBloco titulo="Por canal">
                <StackedBar segments={segmentosCanal} emptyLabel="Nenhuma sessão iniciada ainda" />
              </DistBloco>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h4 className="text-sm font-medium text-gray-700">Satisfação (NPS)</h4>
              <span className="text-[11px] text-gray-400">{totalAvaliacoes} avaliações</span>
            </div>
            <CompareBars
              items={[
                {
                  key: "ia",
                  label: "Assistente virtual (Vox)",
                  value: metrics.nps.ia.media,
                  color: CAT_HEX[0],
                  vazio: metrics.nps.ia.respostas === 0,
                  sub: `${metrics.nps.ia.respostas} resp. · índice ${sinal(metrics.nps.ia.indice)}`,
                },
                {
                  key: "atendente",
                  label: "Atendentes humanos",
                  value: metrics.nps.atendente.media,
                  color: STATUS_HEX.good,
                  vazio: metrics.nps.atendente.respostas === 0,
                  sub: `${metrics.nps.atendente.respostas} resp. · índice ${sinal(metrics.nps.atendente.indice)}`,
                },
              ]}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function sinal(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function SecaoRotulo({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{children}</h3>;
}

function DistBloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <p className="mb-2 text-xs font-medium text-gray-500">{titulo}</p>
      {children}
    </div>
  );
}
