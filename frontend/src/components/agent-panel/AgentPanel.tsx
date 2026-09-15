import { useEffect, useState } from "react";
import { BookOpen, Download } from "lucide-react";
import { civ } from "../../api";
import type { AuditoriaEntry, Briefing, KnowledgeItem, Metrics, SessaoResumo, Usuario } from "../../types";
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
import { Sidebar } from "./Sidebar";

export type Aba = "geral" | "operacao" | "clientes" | "kb" | "atendentes";

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
  const [auditoria, setAuditoria] = useState<AuditoriaEntry[]>([]);
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
    // Métricas e auditoria (Visão geral) são exclusivas do admin — atendente
    // não tem permissão na CIV para essas rotas, então nem chamamos para essa role.
    const [s, f, m, k, a] = await Promise.all([
      civ.sessions(true),
      civ.handoffQueue(),
      usuario.role === "admin" ? civ.metrics() : Promise.resolve(null),
      civ.knowledge(),
      usuario.role === "admin" ? civ.auditoria() : Promise.resolve([]),
    ]);
    setSessoes(s);
    setFila(f);
    setMetrics(m);
    setKb(k);
    setAuditoria(a);
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

  const pendentes = fila.filter((b) => !b.encerrado_em).length;
  const rotuloAba = ABAS.find((a) => a.id === aba)?.rotulo || "";

  return (
    <div className="flex h-full">
      <Sidebar
        abas={ABAS}
        abaAtiva={aba}
        onSelecionar={setAba}
        pendentes={pendentes}
        usuario={usuario}
        onSair={onSair}
      />

      <div className="flex-1 overflow-y-auto bg-claro-gray-light">
        {/* Cabeçalho da página — título da aba atual + status ao vivo */}
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-gray-200 bg-claro-gray-light/95 px-6 py-3.5 backdrop-blur">
          <h2 className="text-base font-semibold text-gray-900">{rotuloAba}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={exportarCsv}
              disabled={exportandoCsv}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-claro-red hover:text-claro-red disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2} />
              {exportandoCsv ? "exportando…" : "Exportar CSV"}
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

        <div className="p-6">
          {aba === "geral" && (
          <VisaoGeralTab
            metrics={metrics}
            sessoesAtivas={sessoes.length}
            flash={flash}
            onEstadoClick={irParaEstado}
            auditoria={auditoria}
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
            <h3 className="mb-3 flex items-center gap-1.5 font-medium text-gray-700">
              <BookOpen className="h-4 w-4 text-gray-400" strokeWidth={2} />
              Base de conhecimento (RAG)
            </h3>
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
