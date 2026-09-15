import { ArrowRightLeft, Gauge, MessageSquare, Radio, ScrollText, Smile } from "lucide-react";
import type { AuditoriaEntry, Metrics } from "../../types";
import { CAT_HEX, DonutChart, Meter, RadialMeter, RankedBars, STATUS_HEX } from "../charts";
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

export function VisaoGeralTab({
  metrics,
  sessoesAtivas,
  flash,
  onEstadoClick,
  auditoria,
  metaTransbordo,
}: {
  metrics: Metrics | null;
  sessoesAtivas: number;
  flash: boolean;
  onEstadoClick: (estado: string) => void;
  auditoria: AuditoriaEntry[];
  // Meta (%) configurável na aba "Configurações" — 25 é só o valor
  // inicial de fallback antes da configuração carregar.
  metaTransbordo?: number;
}) {
  const META_TRANSBORDO = metaTransbordo ?? 25;
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
            icone={ArrowRightLeft}
          >
            <Meter pct={metrics.taxa_transbordo_pct} bom={20} critico={45} meta={META_TRANSBORDO} />
          </KpiCard>
          <KpiCard label="Sessões ativas" value={sessoesAtivas} sub="não encerradas" icone={Radio} />
          <KpiCard
            label="Mensagens trocadas"
            value={metrics.total_mensagens}
            sub="cliente + Vox + atendente"
            icone={MessageSquare}
          />
          <KpiCard
            label="Disponibilidade (SLO)"
            value={`${metrics.disponibilidade_slo_pct}%`}
            sub={`p95 alvo ${metrics.latencia_p95_alvo_ms} ms`}
            icone={Gauge}
          />
        </div>
      </section>

      <section>
        <SecaoRotulo>Composição das sessões</SecaoRotulo>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Cartao titulo="Por estado" sub="clique numa fatia para abrir a Operação filtrada">
            <div className="flex items-center gap-5">
              <DonutChart segments={segmentosEstado} centerLabel="sessões" />
              <div className="flex-1 space-y-1.5">
                {segmentosEstado.map((seg) => (
                  <button
                    key={seg.key}
                    onClick={() => seg.value > 0 && onEstadoClick(seg.key)}
                    disabled={seg.value === 0}
                    className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs transition ${
                      seg.value > 0 ? "hover:bg-claro-gray-light" : "opacity-40"
                    }`}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: seg.color }} />
                    <span className="flex-1 truncate text-gray-600">{seg.label}</span>
                    <span className="font-semibold tabular-nums text-gray-800">{seg.value}</span>
                  </button>
                ))}
              </div>
            </div>
          </Cartao>

          <Cartao titulo="Por tom emocional">
            <RankedBars segments={segmentosTom} emptyLabel="Nenhuma mensagem classificada ainda" />
          </Cartao>

          <Cartao titulo="Por canal">
            <RankedBars segments={segmentosCanal} emptyLabel="Nenhuma sessão iniciada ainda" />
          </Cartao>
        </div>
      </section>

      <section>
        <SecaoRotulo>Satisfação (NPS)</SecaoRotulo>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h4 className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Smile className="h-4 w-4 text-gray-400" strokeWidth={2} />
              Nota média, de 0 a 10
            </h4>
            <span className="text-[11px] text-gray-400">{totalAvaliacoes} avaliações</span>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <NpsGauge
              titulo="Assistente virtual (Vox)"
              cor={CAT_HEX[0]}
              media={metrics.nps.ia.media}
              respostas={metrics.nps.ia.respostas}
              indice={metrics.nps.ia.indice}
            />
            <NpsGauge
              titulo="Atendentes humanos"
              cor={STATUS_HEX.good}
              media={metrics.nps.atendente.media}
              respostas={metrics.nps.atendente.respostas}
              indice={metrics.nps.atendente.indice}
            />
          </div>
        </div>
      </section>

      <section>
        <SecaoRotulo>Auditoria</SecaoRotulo>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h4 className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <ScrollText className="h-4 w-4 text-gray-400" strokeWidth={2} />
              Ações sensíveis recentes
            </h4>
            <span className="text-[11px] text-gray-400">últimos {auditoria.length} registros</span>
          </div>
          {auditoria.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhum registro de auditoria ainda.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-gray-400">
                    <th className="py-1.5 pr-3 font-medium">Ação</th>
                    <th className="py-1.5 pr-3 font-medium">Ator</th>
                    <th className="py-1.5 pr-3 font-medium">Recurso</th>
                    <th className="py-1.5 font-medium">Quando</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditoria.map((a) => (
                    <tr key={a.id}>
                      <td className="py-1.5 pr-3 font-medium text-gray-700">{a.acao}</td>
                      <td className="py-1.5 pr-3 text-gray-500">{a.ator}</td>
                      <td className="py-1.5 pr-3 text-gray-400">{a.recurso_id || "—"}</td>
                      <td className="py-1.5 whitespace-nowrap text-gray-400">{formatarDataHora(a.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function NpsGauge({
  titulo,
  cor,
  media,
  respostas,
  indice,
}: {
  titulo: string;
  cor: string;
  media: number;
  respostas: number;
  indice: number;
}) {
  return (
    <div className="flex items-center gap-4">
      <RadialMeter value={media} max={10} color={cor} vazio={respostas === 0} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-700">{titulo}</p>
        {respostas === 0 ? (
          <p className="text-xs text-gray-400">Sem respostas ainda</p>
        ) : (
          <p className="text-xs text-gray-400">
            {respostas} resp. · índice {sinal(indice)}
          </p>
        )}
      </div>
    </div>
  );
}

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sinal(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function SecaoRotulo({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{children}</h3>;
}

function Cartao({
  titulo,
  sub,
  children,
}: {
  titulo: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium text-gray-700">{titulo}</h4>
        {sub && <span className="text-[10px] text-gray-400">{sub}</span>}
      </div>
      {children}
    </div>
  );
}
