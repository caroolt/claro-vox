import { useEffect, useState } from "react";
import { civ } from "../api";
import type { Briefing, KnowledgeItem, Metrics, SessaoResumo } from "../types";
import { useBriefingSocket } from "../useBriefingSocket";

const ESTADO_COR: Record<string, string> = {
  COLD_START: "bg-blue-100 text-blue-700",
  ATIVA: "bg-green-100 text-green-700",
  TRANSBORDO_PENDENTE: "bg-amber-100 text-amber-700",
  EM_ATENDIMENTO_HUMANO: "bg-purple-100 text-purple-700",
  ENCERRADA: "bg-gray-100 text-gray-500",
};

const TOM_COR: Record<string, string> = {
  frustracao: "bg-red-100 text-red-700",
  urgencia: "bg-orange-100 text-orange-700",
  satisfacao: "bg-green-100 text-green-700",
  neutro: "bg-gray-100 text-gray-600",
};

export function AgentPanel() {
  const [sessoes, setSessoes] = useState<SessaoResumo[]>([]);
  const [fila, setFila] = useState<Briefing[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [kb, setKb] = useState<KnowledgeItem[]>([]);
  const [briefingAberto, setBriefingAberto] = useState<Briefing | null>(null);
  const { ultimoEvento, conectado } = useBriefingSocket();

  async function carregarTudo() {
    const [s, f, m, k] = await Promise.all([civ.sessions(true), civ.handoffQueue(), civ.metrics(), civ.knowledge()]);
    setSessoes(s);
    setFila(f);
    setMetrics(m);
    setKb(k);
  }

  useEffect(() => {
    carregarTudo();
    const interval = setInterval(carregarTudo, 8000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (ultimoEvento) carregarTudo();
  }, [ultimoEvento]);

  async function assumir(id: string) {
    await civ.handoffAssumir(id, "atendente-demo");
    await carregarTudo();
  }

  async function encerrar(id: string) {
    await civ.handoffEncerrar(id);
    setBriefingAberto(null);
    await carregarTudo();
  }

  const pendentes = fila.filter((b) => !b.encerrado_em);

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">Painel do Atendente — Vox Briefing</h2>
        <span className={`text-xs px-2 py-1 rounded-full ${conectado ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}`}>
          {conectado ? "● tempo real conectado" : "○ reconectando…"}
        </span>
      </div>

      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Sessões ativas" value={sessoes.length} />
          <MetricCard label="Taxa de transbordo" value={`${metrics.taxa_transbordo_pct}%`} />
          <MetricCard label="Mensagens trocadas" value={metrics.total_mensagens} />
          <MetricCard label="Disponibilidade (SLO)" value={`${metrics.disponibilidade_slo_pct}%`} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-medium text-gray-700 mb-3">Fila de transbordo (RF007-009)</h3>
          {pendentes.length === 0 && <p className="text-sm text-gray-400">Nenhum atendimento aguardando transbordo no momento.</p>}
          <div className="space-y-2">
            {pendentes.map((b) => (
              <div key={b.id} className="border border-gray-200 rounded-lg p-3 hover:border-claro-red cursor-pointer" onClick={() => setBriefingAberto(b)}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-gray-800">{b.cliente_nome || "Cliente não identificado"}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${TOM_COR[b.tom_emocional] || TOM_COR.neutro}`}>{b.tom_emocional}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{b.motivo_transbordo}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${ESTADO_COR[b.sessao_estado] || ""}`}>{b.sessao_estado}</span>
                  {!b.atendente_id ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        assumir(b.id);
                      }}
                      className="text-xs bg-claro-red text-white px-2 py-1 rounded"
                    >
                      Assumir
                    </button>
                  ) : (
                    <span className="text-[11px] text-gray-400">com {b.atendente_id}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-medium text-gray-700 mb-3">Sessões ativas (contexto persistente — RF001)</h3>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {sessoes.map((s) => (
              <div key={s.id} className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2">
                <div>
                  <span className="text-sm font-medium text-gray-800">{s.cliente_nome || "—"}</span>
                  <span className="text-xs text-gray-400 ml-2">via {s.canal || "?"}</span>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${ESTADO_COR[s.estado] || ""}`}>{s.estado}</span>
              </div>
            ))}
            {sessoes.length === 0 && <p className="text-sm text-gray-400">Nenhuma sessão ativa — inicie uma conversa na aba "Simulador".</p>}
          </div>
        </section>
      </div>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="font-medium text-gray-700 mb-3">Base de conhecimento (RAG)</h3>
        <div className="grid md:grid-cols-2 gap-2">
          {kb.map((item) => (
            <div key={item.id} className="border border-gray-100 rounded-lg p-2.5">
              <p className="text-xs font-medium text-gray-700">{item.titulo}</p>
              <p className="text-[11px] text-gray-400 line-clamp-2">{item.conteudo}</p>
            </div>
          ))}
        </div>
      </section>

      {briefingAberto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setBriefingAberto(null)}>
          <div className="bg-white rounded-xl p-5 max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800 mb-1">Briefing de transbordo</h3>
            <p className="text-sm text-gray-500 mb-3">{briefingAberto.cliente_nome}</p>
            <dl className="space-y-2 text-sm">
              <Row label="Motivo" value={briefingAberto.motivo_transbordo} />
              <Row label="Tom emocional" value={briefingAberto.tom_emocional} />
              <Row label="Canais utilizados" value={briefingAberto.canais_utilizados} />
              <Row label="Resumo da jornada" value={briefingAberto.resumo_jornada} />
              <Row label="Sugestão de resolução" value={briefingAberto.sugestao_resolucao} />
            </dl>
            <div className="flex justify-end gap-2 mt-4">
              {!briefingAberto.atendente_id && (
                <button onClick={() => assumir(briefingAberto.id)} className="text-sm bg-claro-red text-white px-3 py-1.5 rounded">
                  Assumir atendimento
                </button>
              )}
              <button onClick={() => encerrar(briefingAberto.id)} className="text-sm bg-gray-700 text-white px-3 py-1.5 rounded">
                Encerrar sessão
              </button>
              <button onClick={() => setBriefingAberto(null)} className="text-sm text-gray-500 px-3 py-1.5">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <p className="text-[11px] text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-semibold text-gray-800">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-gray-400 uppercase tracking-wide">{label}</dt>
      <dd className="text-gray-700">{value}</dd>
    </div>
  );
}
