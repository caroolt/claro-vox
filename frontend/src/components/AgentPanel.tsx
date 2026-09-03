import { useEffect, useRef, useState } from "react";
import { civ } from "../api";
import type { Briefing, KnowledgeItem, Mensagem, Metrics, SessaoResumo } from "../types";
import { useBriefingSocket, type WsEvent } from "../useBriefingSocket";

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
  const [chatSessao, setChatSessao] = useState<{ id: string; clienteNome: string | null; canal: string } | null>(null);
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
                  <div className="flex items-center gap-1.5">
                    {b.atendente_id && <span className="text-[11px] text-gray-400">com {b.atendente_id}</span>}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        responder(b);
                      }}
                      className="text-xs bg-claro-red text-white px-2 py-1 rounded"
                    >
                      {b.atendente_id ? "Responder" : "Assumir e responder"}
                    </button>
                  </div>
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
                <div className="flex items-center gap-1.5">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${ESTADO_COR[s.estado] || ""}`}>{s.estado}</span>
                  {s.estado === "EM_ATENDIMENTO_HUMANO" && (
                    <button
                      onClick={() => setChatSessao({ id: s.id, clienteNome: s.cliente_nome, canal: s.canal || "whatsapp" })}
                      className="text-[11px] bg-claro-red text-white px-2 py-0.5 rounded"
                    >
                      Abrir chat
                    </button>
                  )}
                </div>
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
              <button onClick={() => responder(briefingAberto)} className="text-sm bg-claro-red text-white px-3 py-1.5 rounded">
                {briefingAberto.atendente_id ? "Responder" : "Assumir e responder"}
              </button>
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg mx-4 h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h3 className="font-semibold text-gray-800">Chat com {clienteNome || "cliente"}</h3>
            <p className="text-xs text-gray-400">
              canal: {canal} · suas mensagens aparecem para o cliente como respostas do Vox
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-gray-50">
          {mensagens.map((m) => (
            <div key={m.id} className={`flex ${m.remetente === "cliente" ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.remetente === "cliente"
                  ? "bg-white text-gray-800 border border-gray-200 rounded-bl-sm"
                  : "bg-claro-red text-white rounded-br-sm"
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

        <div className="border-t border-gray-200 p-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enviar()}
            placeholder="Responder como atendente…"
            disabled={enviando}
            className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-claro-red"
          />
          <button
            onClick={enviar}
            disabled={enviando || !input.trim()}
            className="bg-claro-red text-white px-4 py-2 rounded-full text-sm font-medium disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
      </div>
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
