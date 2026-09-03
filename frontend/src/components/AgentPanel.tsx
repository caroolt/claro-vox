import { useEffect, useRef, useState } from "react";
import { civ } from "../api";
import type { Briefing, KnowledgeItem, Mensagem, Metrics, SessaoResumo } from "../types";
import { useBriefingSocket, type WsEvent } from "../useBriefingSocket";
import { CAT_HEX, Meter, StackedBar, STATUS_HEX, type Segment } from "./charts";

// Metadados de exibição por estado de sessão — a cor reflete a urgência
// operacional (o que precisa da atenção do atendente agora), não é uma
// paleta categórica solta.
const ESTADO_META: Record<string, { label: string; status: keyof typeof STATUS_HEX; badge: string }> = {
  COLD_START: { label: "Cold Start", status: "neutral", badge: "bg-gray-100 text-gray-600" },
  ATIVA: { label: "Ativa", status: "good", badge: "bg-green-100 text-green-700" },
  TRANSBORDO_PENDENTE: { label: "Transbordo pendente", status: "critical", badge: "bg-red-100 text-red-700" },
  EM_ATENDIMENTO_HUMANO: { label: "Com atendente humano", status: "warning", badge: "bg-amber-100 text-amber-800" },
  ENCERRADA: { label: "Encerrada", status: "neutral", badge: "bg-gray-100 text-gray-500" },
};
const ESTADO_ORDEM = ["TRANSBORDO_PENDENTE", "EM_ATENDIMENTO_HUMANO", "ATIVA", "COLD_START", "ENCERRADA"];

const TOM_META: Record<string, { label: string; status: keyof typeof STATUS_HEX; badge: string }> = {
  frustracao: { label: "Frustração", status: "critical", badge: "bg-red-100 text-red-700" },
  urgencia: { label: "Urgência", status: "warning", badge: "bg-amber-100 text-amber-800" },
  satisfacao: { label: "Satisfação", status: "good", badge: "bg-green-100 text-green-700" },
  neutro: { label: "Neutro", status: "neutral", badge: "bg-gray-100 text-gray-600" },
};
const TOM_ORDEM = ["frustracao", "urgencia", "satisfacao", "neutro"];

const CANAL_META: Record<string, { label: string; icone: string }> = {
  whatsapp: { label: "WhatsApp", icone: "💬" },
  site: { label: "Site", icone: "🌐" },
  app: { label: "App Claro", icone: "📱" },
  voz: { label: "Central de Voz", icone: "☎️" },
};
const CANAL_ORDEM = ["whatsapp", "site", "app", "voz"];

// Monta a lista de segmentos de um breakdown (Record<chave,valor>) na ordem
// fixa definida acima — chaves não previstas entram no fim, sem quebrar.
function montarSegmentos<T extends { label: string }>(
  dados: Record<string, number>,
  meta: Record<string, T>,
  ordem: string[],
  cor: (chave: string, meta: T | undefined) => string
): Segment[] {
  const chaves = [...ordem, ...Object.keys(dados).filter((k) => !ordem.includes(k))];
  return chaves
    .filter((k) => dados[k] !== undefined)
    .map((k) => ({ key: k, label: meta[k]?.label || k, value: dados[k] || 0, color: cor(k, meta[k]) }));
}

export function AgentPanel() {
  const [sessoes, setSessoes] = useState<SessaoResumo[]>([]);
  const [fila, setFila] = useState<Briefing[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [kb, setKb] = useState<KnowledgeItem[]>([]);
  const [briefingAberto, setBriefingAberto] = useState<Briefing | null>(null);
  const [chatSessao, setChatSessao] = useState<{ id: string; clienteNome: string | null; canal: string } | null>(null);
  const [filaTab, setFilaTab] = useState<"pendentes" | "todos">("pendentes");
  const [filtroEstado, setFiltroEstado] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const { ultimoEvento, conectado } = useBriefingSocket();

  async function carregarTudo() {
    const [s, f, m, k] = await Promise.all([civ.sessions(true), civ.handoffQueue(), civ.metrics(), civ.knowledge()]);
    setSessoes(s);
    setFila(f);
    setMetrics(m);
    setKb(k);
    setAtualizadoEm(new Date());
  }

  useEffect(() => {
    carregarTudo();
    const interval = setInterval(carregarTudo, 8000);
    return () => clearInterval(interval);
  }, []);

  // Pisca suavemente o quadro de indicadores a cada evento em tempo real —
  // dá ao atendente um sinal visual periférico de que algo mudou, sem
  // precisar ficar lendo números o tempo todo.
  useEffect(() => {
    if (!ultimoEvento) return;
    carregarTudo();
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function canalDaSessao(sessaoId: string, fallback: string): string {
    return sessoes.find((s) => s.id === sessaoId)?.canal || fallback.split(",")[0]?.trim() || "whatsapp";
  }

  async function responder(b: Briefing) {
    if (!b.atendente_id) {
      await civ.handoffAssumir(b.id, "atendente-demo");
      await carregarTudo();
    }
    setBriefingAberto(null);
    setChatSessao({ id: b.sessao_id, clienteNome: b.cliente_nome, canal: canalDaSessao(b.sessao_id, b.canais_utilizados) });
  }

  const pendentes = fila.filter((b) => !b.encerrado_em);
  const filaExibida = filaTab === "pendentes" ? pendentes : fila;

  const sessoesFiltradas = filtroEstado ? sessoes.filter((s) => s.estado === filtroEstado) : sessoes;

  const segmentosEstado = metrics
    ? montarSegmentos(metrics.sessoes_por_estado, ESTADO_META, ESTADO_ORDEM, (_k, m) => STATUS_HEX[m?.status || "neutral"])
    : [];
  const segmentosTom = metrics
    ? montarSegmentos(metrics.tom_emocional, TOM_META, TOM_ORDEM, (_k, m) => STATUS_HEX[m?.status || "neutral"])
    : [];
  const segmentosCanal = metrics
    ? montarSegmentos(metrics.sessoes_por_canal, CANAL_META, CANAL_ORDEM, (k) => {
        const idx = CANAL_ORDEM.indexOf(k);
        return CAT_HEX[idx >= 0 ? idx : 0];
      })
    : [];

  return (
    <div className="h-full overflow-y-auto bg-claro-gray-light p-4 space-y-4">
      {/* Cabeçalho com identidade da marca — lockup "Claro" + "Vox" seguindo
          o mesmo padrão documentado no manual para extensões de produto
          (Claro hdtv, Claro fixo, Claro tv…): wordmark vermelho + sufixo
          preto, tipografia Arial Bold. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-claro-red text-base font-bold text-white shadow-sm">
            V
          </span>
          <div>
            <h2 className="text-lg font-bold leading-tight text-gray-900">
              <span className="text-claro-red">Claro</span> Vox
            </h2>
            <p className="text-[11px] leading-tight text-gray-400">Painel do atendente — Vox Briefing</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {atualizadoEm && (
            <span className="hidden text-[11px] text-gray-400 sm:inline">
              atualizado {atualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              conectado ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${conectado ? "bg-green-500" : "bg-gray-400"} ${conectado ? "vox-pulse" : ""}`}
            />
            {conectado ? "tempo real conectado" : "reconectando…"}
          </span>
        </div>
      </div>

      {/* Indicadores principais */}
      {metrics && (
        <div className={`grid grid-cols-1 gap-3 rounded-xl sm:grid-cols-2 lg:grid-cols-4 ${flash ? "vox-flash" : ""}`}>
          <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Taxa de transbordo</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums text-gray-900">{metrics.taxa_transbordo_pct}%</span>
              <span className="text-xs text-gray-400">
                {metrics.total_transbordos} de {metrics.total_sessoes} sessões precisaram de atendimento humano
              </span>
            </div>
            <div className="mt-3">
              <Meter pct={metrics.taxa_transbordo_pct} bom={20} critico={45} meta={25} />
            </div>
          </div>
          <KpiCard label="Sessões ativas" value={sessoes.length} sub="não encerradas" />
          <KpiCard label="Mensagens trocadas" value={metrics.total_mensagens} sub="cliente + Vox + atendente" />
          <KpiCard
            label="Disponibilidade (SLO)"
            value={`${metrics.disponibilidade_slo_pct}%`}
            sub={`meta: ${metrics.disponibilidade_slo_pct}% · p95 alvo ${metrics.latencia_p95_alvo_ms}ms`}
          />
        </div>
      )}

      {/* Gráficos de composição — clique num estado filtra a lista de
          sessões abaixo (RF001: mesma jornada, visão consolidada). */}
      {metrics && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700">Sessões por estado</h3>
              {filtroEstado && (
                <button onClick={() => setFiltroEstado(null)} className="text-[11px] text-claro-red hover:underline">
                  limpar filtro ×
                </button>
              )}
            </div>
            <StackedBar segments={segmentosEstado} onSelect={setFiltroEstado} selectedKey={filtroEstado} />
          </section>
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-medium text-gray-700">Tom emocional das conversas</h3>
            <StackedBar segments={segmentosTom} emptyLabel="Nenhuma mensagem classificada ainda" />
          </section>
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-medium text-gray-700">Sessões por canal</h3>
            <StackedBar segments={segmentosCanal} emptyLabel="Nenhuma sessão iniciada ainda" />
          </section>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium text-gray-700">Fila de transbordo (RF007-009)</h3>
            <div className="flex rounded-lg bg-gray-100 p-0.5 text-xs">
              <button
                onClick={() => setFilaTab("pendentes")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  filaTab === "pendentes" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"
                }`}
              >
                Pendentes ({pendentes.length})
              </button>
              <button
                onClick={() => setFilaTab("todos")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  filaTab === "todos" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"
                }`}
              >
                Histórico ({fila.length})
              </button>
            </div>
          </div>
          {filaExibida.length === 0 && (
            <p className="text-sm text-gray-400">
              {filaTab === "pendentes" ? "Nenhum atendimento aguardando transbordo no momento." : "Nenhum transbordo registrado ainda."}
            </p>
          )}
          <div className="space-y-2">
            {filaExibida.map((b) => (
              <div
                key={b.id}
                className="vox-fade-in cursor-pointer rounded-lg border border-gray-200 p-3 hover:border-claro-red"
                onClick={() => setBriefingAberto(b)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-800">{b.cliente_nome || "Cliente não identificado"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${TOM_META[b.tom_emocional]?.badge || TOM_META.neutro.badge}`}>
                    {TOM_META[b.tom_emocional]?.label || b.tom_emocional}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-gray-500">{b.motivo_transbordo}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${ESTADO_META[b.sessao_estado]?.badge || ""}`}>
                    {b.encerrado_em ? "resolvido" : ESTADO_META[b.sessao_estado]?.label || b.sessao_estado}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {b.atendente_id && <span className="text-[11px] text-gray-400">com {b.atendente_id}</span>}
                    {!b.encerrado_em && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          responder(b);
                        }}
                        className="rounded bg-claro-red px-2 py-1 text-xs text-white hover:bg-claro-red-dark"
                      >
                        {b.atendente_id ? "Responder" : "Assumir e responder"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium text-gray-700">Sessões ativas (contexto persistente — RF001)</h3>
            {filtroEstado && (
              <span className="flex items-center gap-1 rounded-full bg-claro-red-light px-2 py-0.5 text-[11px] font-medium text-claro-red">
                {ESTADO_META[filtroEstado]?.label || filtroEstado}
                <button onClick={() => setFiltroEstado(null)} className="ml-0.5 hover:text-claro-red-dark">
                  ×
                </button>
              </span>
            )}
          </div>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {sessoesFiltradas.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                <div>
                  <span className="text-sm font-medium text-gray-800">{s.cliente_nome || "—"}</span>
                  <span className="ml-2 text-xs text-gray-400">
                    {CANAL_META[s.canal || ""]?.icone} via {CANAL_META[s.canal || ""]?.label || s.canal || "?"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${ESTADO_META[s.estado]?.badge || ""}`}>
                    {ESTADO_META[s.estado]?.label || s.estado}
                  </span>
                  {s.estado === "EM_ATENDIMENTO_HUMANO" && (
                    <button
                      onClick={() => setChatSessao({ id: s.id, clienteNome: s.cliente_nome, canal: s.canal || "whatsapp" })}
                      className="rounded bg-claro-red px-2 py-0.5 text-[11px] text-white hover:bg-claro-red-dark"
                    >
                      Abrir chat
                    </button>
                  )}
                </div>
              </div>
            ))}
            {sessoesFiltradas.length === 0 && (
              <p className="text-sm text-gray-400">
                {filtroEstado ? "Nenhuma sessão nesse estado no momento." : 'Nenhuma sessão ativa — inicie uma conversa na aba "Simulador".'}
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 font-medium text-gray-700">Base de conhecimento (RAG)</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {kb.map((item) => (
            <div key={item.id} className="rounded-lg border border-gray-100 p-2.5">
              <p className="text-xs font-medium text-gray-700">{item.titulo}</p>
              <p className="line-clamp-2 text-[11px] text-gray-400">{item.conteudo}</p>
            </div>
          ))}
        </div>
      </section>

      {briefingAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setBriefingAberto(null)}>
          <div className="mx-4 w-full max-w-lg rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 font-semibold text-gray-800">Briefing de transbordo</h3>
            <p className="mb-3 text-sm text-gray-500">{briefingAberto.cliente_nome}</p>
            <dl className="space-y-2 text-sm">
              <Row label="Motivo" value={briefingAberto.motivo_transbordo} />
              <Row label="Tom emocional" value={TOM_META[briefingAberto.tom_emocional]?.label || briefingAberto.tom_emocional} />
              <Row label="Canais utilizados" value={briefingAberto.canais_utilizados} />
              <Row label="Resumo da jornada" value={briefingAberto.resumo_jornada} />
              <Row label="Sugestão de resolução" value={briefingAberto.sugestao_resolucao} />
            </dl>
            <div className="mt-4 flex justify-end gap-2">
              {!briefingAberto.encerrado_em && (
                <>
                  <button onClick={() => responder(briefingAberto)} className="rounded bg-claro-red px-3 py-1.5 text-sm text-white hover:bg-claro-red-dark">
                    {briefingAberto.atendente_id ? "Responder" : "Assumir e responder"}
                  </button>
                  <button onClick={() => encerrar(briefingAberto.id)} className="rounded bg-gray-700 px-3 py-1.5 text-sm text-white">
                    Encerrar sessão
                  </button>
                </>
              )}
              <button onClick={() => setBriefingAberto(null)} className="px-3 py-1.5 text-sm text-gray-500">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {chatSessao && (
        <SessionChatPanel
          sessaoId={chatSessao.id}
          clienteNome={chatSessao.clienteNome}
          canal={chatSessao.canal}
          ultimoEvento={ultimoEvento}
          onClose={() => setChatSessao(null)}
        />
      )}
    </div>
  );
}

function SessionChatPanel({
  sessaoId,
  clienteNome,
  canal,
  ultimoEvento,
  onClose,
}: {
  sessaoId: string;
  clienteNome: string | null;
  canal: string;
  ultimoEvento: WsEvent | null;
  onClose: () => void;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  async function carregar() {
    const msgs = await civ.sessionMessages(sessaoId);
    setMensagens(msgs);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessaoId]);

  useEffect(() => {
    const payload = ultimoEvento?.payload as { sessao_id?: string } | undefined;
    if (ultimoEvento?.type === "message.created" && payload?.sessao_id === sessaoId) {
      carregar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultimoEvento]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  async function enviar() {
    if (!input.trim() || enviando) return;
    const texto = input.trim();
    setInput("");
    setEnviando(true);
    try {
      await civ.enviarMensagem(sessaoId, "atendente", canal, texto);
      await carregar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="mx-4 flex h-[70vh] w-full max-w-lg flex-col rounded-xl bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h3 className="font-semibold text-gray-800">Chat com {clienteNome || "cliente"}</h3>
            <p className="text-xs text-gray-400">
              canal: {canal} · suas mensagens aparecem para o cliente como respostas do Vox
            </p>
          </div>
          <button onClick={onClose} className="text-lg leading-none text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto bg-gray-50 px-4 py-3">
          {mensagens.map((m) => (
            <div key={m.id} className={`flex ${m.remetente === "cliente" ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  m.remetente === "cliente"
                    ? "rounded-bl-sm border border-gray-200 bg-white text-gray-800"
                    : "rounded-br-sm bg-claro-red text-white"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.conteudo}</p>
                <p className={`mt-0.5 text-[10px] ${m.remetente === "cliente" ? "text-gray-400" : "text-red-100"}`}>
                  {m.remetente === "cliente" ? "cliente" : m.remetente === "atendente" ? "você (atendente)" : "vox (IA)"}
                </p>
              </div>
            </div>
          ))}
          <div ref={fimRef} />
        </div>

        <div className="flex gap-2 border-t border-gray-200 p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enviar()}
            placeholder="Responder como atendente…"
            disabled={enviando}
            className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm focus:border-claro-red focus:outline-none"
          />
          <button
            onClick={enviar}
            disabled={enviando || !input.trim()}
            className="rounded-full bg-claro-red px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-gray-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-gray-700">{value}</dd>
    </div>
  );
}
