import { useEffect, useState } from "react";
import { civ } from "../../api";
import logoClaroVox from "../../assets/claro-vox-logo.png";
import type { Briefing, KnowledgeItem, Metrics, SessaoResumo, Usuario } from "../../types";
import { useBriefingSocket } from "../../useBriefingSocket";
import { FILTROS_VAZIOS, type FiltrosOperacao } from "./meta";
import { exportarBriefingZip } from "./exportar";
import { VisaoGeralTab } from "./VisaoGeralTab";
import { OperacaoTab } from "./OperacaoTab";
import { ClientesTab } from "./ClientesTab";
import { ClienteDrawer } from "./ClienteDrawer";
import { BriefingModal } from "./BriefingModal";
import { SessionChatPanel } from "./SessionChatPanel";
import { AtendentesTab } from "./AtendentesTab";

type Aba = "geral" | "operacao" | "clientes" | "kb" | "atendentes";

const ABAS_POR_ROLE: Record<Usuario["role"], { id: Aba; rotulo: string }[]> = {
  // Admin vê todas as abas do Vox Briefing + a gestão de atendentes.
  admin: [
    { id: "geral", rotulo: "Visão geral" },
    { id: "operacao", rotulo: "Operação" },
    { id: "clientes", rotulo: "Clientes" },
    { id: "kb", rotulo: "Conhecimento" },
    { id: "atendentes", rotulo: "Atendentes" },
  ],
  // Atendente vê só o que precisa para o dia a dia — sem métricas do
  // negócio nem gestão de contas.
  atendente: [
    { id: "operacao", rotulo: "Operação" },
    { id: "clientes", rotulo: "Clientes" },
    { id: "kb", rotulo: "Conhecimento" },
  ],
};

type ChatSessao = { id: string; clienteNome: string | null; canal: string };

export function AgentPanel({ usuario, onSair }: { usuario: Usuario; onSair: () => void }) {
  const ABAS = ABAS_POR_ROLE[usuario.role];
  const [aba, setAba] = useState<Aba>(ABAS[0].id);
  const [sessoes, setSessoes] = useState<SessaoResumo[]>([]);
  const [fila, setFila] = useState<Briefing[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [kb, setKb] = useState<KnowledgeItem[]>([]);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [flash, setFlash] = useState(false);

  const [exportandoCsv, setExportandoCsv] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosOperacao>(FILTROS_VAZIOS);
  const [clienteDrawerId, setClienteDrawerId] = useState<string | null>(null);
  const [briefingAberto, setBriefingAberto] = useState<Briefing | null>(null);
  const [chatSessao, setChatSessao] = useState<ChatSessao | null>(null);

  const { ultimoEvento, conectado } = useBriefingSocket();

  async function carregarTudo() {
    // Métricas (Visão geral) são exclusivas do admin — atendente não tem
    // permissão na CIV para essa rota, então nem chamamos para essa role.
    const [s, f, m, k] = await Promise.all([
      civ.sessions(true),
      civ.handoffQueue(),
      usuario.role === "admin" ? civ.metrics() : Promise.resolve(null),
      civ.knowledge(),
    ]);
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

  // Pisca o painel a cada evento em tempo real — sinal periférico de mudança.
  useEffect(() => {
    if (!ultimoEvento) return;
    carregarTudo();
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultimoEvento]);

  function canalDaSessao(sessaoId: string, fallback: string): string {
    return sessoes.find((s) => s.id === sessaoId)?.canal || fallback.split(",")[0]?.trim() || "whatsapp";
  }

  async function responder(b: Briefing) {
    if (!b.atendente_id) {
      await civ.handoffAssumir(b.id);
      await carregarTudo();
    }
    setBriefingAberto(null);
    setChatSessao({
      id: b.sessao_id,
      clienteNome: b.cliente_nome,
      canal: canalDaSessao(b.sessao_id, b.canal || b.canais_utilizados),
    });
  }

  async function encerrar(id: string) {
    await civ.handoffEncerrar(id);
    setBriefingAberto(null);
    await carregarTudo();
  }

  function irParaEstado(estado: string) {
    setFiltros({ ...FILTROS_VAZIOS, estado });
    setAba("operacao");
  }

  async function exportarCsv() {
    setExportandoCsv(true);
    try {
      await exportarBriefingZip({ sessoes, fila, metrics });
    } finally {
      setExportandoCsv(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-claro-gray-light">
      {/* Cabeçalho com identidade da marca */}
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-claro-gray-light px-4 pb-2 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex rounded-lg bg-claro-black px-2 py-1 shadow-sm">
              <img src={logoClaroVox} alt="Claro Vox" className="h-5 w-auto" />
            </span>
            <p className="text-[11px] leading-tight text-gray-400">Painel do atendente — Vox Briefing</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-gray-400 sm:inline">
              {usuario.nome} · <span className="uppercase">{usuario.role}</span>
            </span>
            <button
              onClick={onSair}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-claro-red hover:text-claro-red"
            >
              Sair
            </button>
            <button
              onClick={exportarCsv}
              disabled={exportandoCsv}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-claro-red hover:text-claro-red disabled:opacity-50"
            >
              {exportandoCsv ? "exportando…" : "⬇ Exportar CSV"}
            </button>
            {atualizadoEm && (
              <span className="hidden text-[11px] text-gray-400 sm:inline">
                atualizado{" "}
                {atualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
            <span
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                conectado ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${conectado ? "bg-green-500" : "bg-gray-400"} ${
                  conectado ? "vox-pulse" : ""
                }`}
              />
              {conectado ? "tempo real conectado" : "reconectando…"}
            </span>
          </div>
        </div>

        {/* Sub-abas do painel */}
        <nav className="mt-2 flex gap-1">
          {ABAS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAba(a.id)}
              className={`rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition ${
                aba === a.id
                  ? "border-claro-red text-claro-red"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {a.rotulo}
              {a.id === "operacao" && fila.filter((b) => !b.encerrado_em).length > 0 && (
                <span className="ml-1.5 rounded-full bg-claro-red px-1.5 text-[10px] text-white">
                  {fila.filter((b) => !b.encerrado_em).length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="p-4">
        {aba === "geral" && (
          <VisaoGeralTab
            metrics={metrics}
            sessoesAtivas={sessoes.length}
            flash={flash}
            onEstadoClick={irParaEstado}
          />
        )}

        {aba === "operacao" && (
          <OperacaoTab
            sessoes={sessoes}
            fila={fila}
            filtros={filtros}
            setFiltros={setFiltros}
            onAbrirCliente={setClienteDrawerId}
            onResponder={responder}
            onAbrirBriefing={setBriefingAberto}
            onAbrirChat={setChatSessao}
          />
        )}

        {aba === "clientes" && (
          <ClientesTab ultimoEvento={ultimoEvento} onAbrirCliente={setClienteDrawerId} />
        )}

        {aba === "kb" && (
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 font-medium text-gray-700">Base de conhecimento (RAG)</h3>
            <div className="grid gap-2 md:grid-cols-2">
              {kb.map((item) => (
                <div key={item.id} className="rounded-lg border border-gray-100 p-2.5">
                  <p className="text-xs font-medium text-gray-700">{item.titulo}</p>
                  <p className="line-clamp-3 text-[11px] text-gray-400">{item.conteudo}</p>
                </div>
              ))}
              {kb.length === 0 && <p className="text-sm text-gray-400">Base de conhecimento vazia.</p>}
            </div>
          </section>
        )}

        {aba === "atendentes" && <AtendentesTab usuarioLogadoId={usuario.id} />}
      </div>

      {briefingAberto && (
        <BriefingModal
          briefing={briefingAberto}
          onResponder={responder}
          onEncerrar={encerrar}
          onClose={() => setBriefingAberto(null)}
        />
      )}

      {clienteDrawerId && (
        <ClienteDrawer
          clienteId={clienteDrawerId}
          ultimoEvento={ultimoEvento}
          onClose={() => setClienteDrawerId(null)}
          onAbrirChat={setChatSessao}
          onExcluido={carregarTudo}
        />
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
