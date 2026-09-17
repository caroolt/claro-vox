import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  History,
  Info,
  Lock,
  Search,
  ShieldAlert,
  Unlock,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { civ, fraude } from "../../api";
import type { AlertaFraude, CasoFraude, GrafoFraude, StatusCaso } from "../../types";
import type { WsEvent } from "../../useBriefingSocket";
import { SectionTitle } from "./ui";
import { fmtDataHora, RISCO_FRAUDE_META as CONFIANCA_META, STATUS_RESOLUCAO_FRAUDE_META as STATUS_RESOLUCAO_META } from "./meta";

interface ClienteEvidencia {
  id: string;
  nome: string;
}

const REGRA_META: Record<string, { titulo: string; rotuloAresta: string }> = {
  A_volume_cpf: { titulo: "Volume de linhas no mesmo CPF", rotuloAresta: "linha pré-paga" },
  B_dispositivo_ip: { titulo: "Dispositivo/IP compartilhado", rotuloAresta: "dispositivo/IP" },
  C_estilo_escrita: { titulo: "Estilo de escrita semelhante", rotuloAresta: "estilo semelhante" },
};

const STATUS_CASO_META: Record<StatusCaso, { label: string; badge: string }> = {
  aberto: { label: "Aguardando triagem", badge: "bg-red-100 text-red-700" },
  em_investigacao: { label: "Em investigação", badge: "bg-blue-100 text-blue-700" },
  revisado: { label: "Revisado", badge: "bg-green-100 text-green-700" },
  descartado: { label: "Descartado", badge: "bg-gray-100 text-gray-600" },
};

// Layout circular simples — o grafo é sempre o de UM caso (nunca mais o de
// todos os alertas abertos do sistema), então fica pequeno por construção.
function calcularPosicoes(ids: string[]): Record<string, { x: number; y: number }> {
  const raio = Math.max(140, ids.length * 30);
  const centro = raio + 60;
  const posicoes: Record<string, { x: number; y: number }> = {};
  ids.forEach((id, i) => {
    const angulo = (2 * Math.PI * i) / Math.max(ids.length, 1);
    posicoes[id] = { x: centro + raio * Math.cos(angulo), y: centro + raio * Math.sin(angulo) };
  });
  return posicoes;
}

function clientesDoAlerta(alerta: AlertaFraude): ClienteEvidencia[] {
  return (alerta.evidencia.clientes as ClienteEvidencia[] | undefined) || [];
}

function clientesDoCaso(caso: CasoFraude): ClienteEvidencia[] {
  const porId = new Map<string, ClienteEvidencia>();
  caso.alertas.forEach((a) => clientesDoAlerta(a).forEach((c) => porId.set(c.id, c)));
  return [...porId.values()];
}

function regrasDoCaso(caso: CasoFraude): string[] {
  return [...new Set(caso.alertas.map((a) => a.regra))];
}

export function FraudeTab({
  onAbrirCliente,
  ultimoEvento,
  focoInicial,
  usuarioNome,
}: {
  onAbrirCliente: (id: string) => void;
  ultimoEvento?: WsEvent | null;
  focoInicial?: { nome: string; ts: number } | null;
  usuarioNome: string;
}) {
  const [aba, setAba] = useState<"casos" | "resolvidos">("casos");
  const [casos, setCasos] = useState<CasoFraude[]>([]);
  const [historico, setHistorico] = useState<AlertaFraude[]>([]);
  const [cursorHistorico, setCursorHistorico] = useState<string | null>(null);
  const [carregandoMais, setCarregandoMais] = useState(false);

  const [busca, setBusca] = useState("");
  const [filtroRegra, setFiltroRegra] = useState("");
  const [filtroConfianca, setFiltroConfianca] = useState("");
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const [grafoAberto, setGrafoAberto] = useState<string | null>(null);
  const [grafo, setGrafo] = useState<GrafoFraude | null>(null);
  const [carregandoGrafo, setCarregandoGrafo] = useState(false);
  const [explicacao, setExplicacao] = useState<{ titulo: string; alerta: AlertaFraude } | null>(null);
  const [resolvendo, setResolvendo] = useState<
    { tipo: "caso"; caso: CasoFraude } | { tipo: "alerta"; alerta: AlertaFraude } | null
  >(null);

  const termoBusca = busca.trim();
  const filtros = useMemo(
    () => ({
      regra: (filtroRegra || undefined) as AlertaFraude["regra"] | undefined,
      confianca: (filtroConfianca || undefined) as AlertaFraude["confianca"] | undefined,
      desde: filtroDataInicio || undefined,
      ate: filtroDataFim || undefined,
      q: termoBusca || undefined,
    }),
    [filtroRegra, filtroConfianca, filtroDataInicio, filtroDataFim, termoBusca]
  );

  // Todo filtro (regra/confiança/período/nome) agora é resolvido no
  // servidor — nunca mais carrega a lista inteira pra filtrar no navegador,
  // o que não escalaria além de uma base pequena de alertas abertos.
  async function carregarCasos() {
    setCarregando(true);
    try {
      const c = await fraude.casos(filtros);
      setCasos(c);
      setErro(null);
    } catch {
      setErro("Não foi possível carregar os casos de fraude.");
    } finally {
      setCarregando(false);
    }
  }

  async function carregarHistorico(continuar: boolean) {
    if (continuar) setCarregandoMais(true);
    else setCarregando(true);
    try {
      const pagina = await fraude.historico({ ...filtros, cursor: continuar ? cursorHistorico || undefined : undefined });
      setHistorico((atual) => (continuar ? [...atual, ...pagina.itens] : pagina.itens));
      setCursorHistorico(pagina.proximo_cursor);
      setErro(null);
    } catch {
      setErro("Não foi possível carregar o histórico.");
    } finally {
      setCarregando(false);
      setCarregandoMais(false);
    }
  }

  useEffect(() => {
    if (aba === "casos") carregarCasos();
    else carregarHistorico(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, filtros]);

  // Tempo real: a CIV avisa via WebSocket quando um alerta muda (criado
  // pelo job periódico ou pela Regra A em tempo real na contratação) ou
  // quando um caso é assumido/liberado por outro analista conectado.
  useEffect(() => {
    if (!ultimoEvento) return;
    const eventosRelevantes = [
      "fraude.alerta.criado",
      "fraude.alerta.atualizado",
      "fraude.caso.assumido",
      "fraude.caso.liberado",
    ];
    if (eventosRelevantes.includes(ultimoEvento.type)) {
      if (aba === "casos") carregarCasos();
      else carregarHistorico(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultimoEvento]);

  useEffect(() => {
    if (focoInicial) setBusca(focoInicial.nome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focoInicial]);

  function alternarExpandido(casoId: string) {
    setExpandido((atual) => {
      const novo = new Set(atual);
      if (novo.has(casoId)) novo.delete(casoId);
      else novo.add(casoId);
      return novo;
    });
  }

  async function alternarGrafo(casoId: string) {
    if (grafoAberto === casoId) {
      setGrafoAberto(null);
      return;
    }
    setGrafoAberto(casoId);
    setGrafo(null);
    setCarregandoGrafo(true);
    try {
      const g = await fraude.grafoCaso(casoId);
      setGrafo(g);
    } finally {
      setCarregandoGrafo(false);
    }
  }

  async function assumirCaso(casoId: string) {
    try {
      await fraude.casoAssumir(casoId);
      await carregarCasos();
    } catch {
      alert("Não foi possível assumir este caso — outro analista pode já tê-lo assumido.");
      await carregarCasos();
    }
  }

  async function liberarCaso(casoId: string) {
    await fraude.casoLiberar(casoId);
    await carregarCasos();
  }

  async function descartarCaso(casoId: string) {
    if (!confirm("Descartar todos os alertas em aberto deste caso como falso positivo?")) return;
    await fraude.casoResolver(casoId, "descartado");
    await carregarCasos();
  }

  async function descartarAlerta(alertaId: string) {
    await fraude.atualizarAlerta(alertaId, "descartado");
    setExplicacao(null);
    await carregarCasos();
  }

  async function confirmarResolucao(nota: string) {
    if (!resolvendo) return;
    if (resolvendo.tipo === "caso") await fraude.casoResolver(resolvendo.caso.id, "revisado", nota);
    else await fraude.atualizarAlerta(resolvendo.alerta.id, "revisado", nota);
    setResolvendo(null);
    setExplicacao(null);
    await carregarCasos();
  }

  // Ação de baixo atrito pedida junto com o alerta vermelho: bloquear (ou
  // desbloquear) o cliente direto da fila, em um clique + confirmação. Um
  // cliente pode aparecer em mais de um alerta dentro do mesmo caso (ex.:
  // Regra A e Regra C ao mesmo tempo) — bloquear resolve o CASO inteiro, não
  // só o alerta que originou o chip, já que bloquear é uma decisão que
  // normalmente conclui a investigação inteira.
  async function alternarBloqueio(caso: CasoFraude, cliente: ClienteEvidencia, bloquearAgora: boolean) {
    const pergunta = bloquearAgora
      ? `Bloquear "${cliente.nome}"? Ele não vai conseguir confirmar novas contratações até ser desbloqueado.`
      : `Desbloquear "${cliente.nome}"?`;
    if (!confirm(pergunta)) return;
    await civ.bloquearCliente(cliente.id, bloquearAgora, bloquearAgora ? "Bloqueado a partir de alerta de fraude" : undefined);
    if (bloquearAgora) {
      await fraude.casoResolver(caso.id, "revisado", `Cliente "${cliente.nome}" bloqueado a partir deste caso.`);
    }
    await carregarCasos();
  }

  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    if (!grafo) return { nodes: [], edges: [] };
    const posicoes = calcularPosicoes(grafo.nos.map((n) => n.id));
    const nodes: Node[] = grafo.nos.map((n) => ({
      id: n.id,
      position: posicoes[n.id],
      data: { label: n.tipo === "cliente" && n.bloqueado ? `🔒 ${n.nome}` : n.nome, tipo: n.tipo },
      style:
        n.tipo === "cliente"
          ? {
              borderRadius: 10,
              border: n.bloqueado ? "2px solid #6b7280" : "2px solid #E4002B",
              background: n.bloqueado ? "#f3f4f6" : "#FEF2F2",
              color: n.bloqueado ? "#6b7280" : undefined,
              fontSize: 12,
              padding: 8,
            }
          : {
              borderRadius: 8,
              border: "1px dashed #9ca3af",
              background: "#f9fafb",
              color: "#6b7280",
              fontSize: 11,
              padding: 6,
            },
    }));
    const edges: Edge[] = grafo.arestas.map((a) => ({
      id: a.id,
      source: a.origem,
      target: a.destino,
      data: { alerta_id: a.alerta_id },
      label: REGRA_META[a.regra]?.rotuloAresta || a.regra,
      animated: a.confianca === "alta",
      style: {
        stroke: a.regra === "A_volume_cpf" ? "#9ca3af" : a.confianca === "alta" ? "#E4002B" : "#9ca3af",
        strokeDasharray: a.regra === "C_estilo_escrita" ? "5 4" : undefined,
      },
      labelStyle: { fontSize: 10, fill: "#6b7280" },
    }));
    return { nodes, edges };
  }, [grafo]);

  function onGrafoNodeClick(_: unknown, node: Node) {
    if (node.data?.tipo === "cliente") onAbrirCliente(node.id);
  }

  const alertaPorId = useMemo(() => {
    const mapa = new Map<string, AlertaFraude>();
    casos.forEach((c) => c.alertas.forEach((a) => mapa.set(a.id, a)));
    return mapa;
  }, [casos]);

  function onGrafoEdgeClick(_: unknown, edge: Edge) {
    const alertaId = String(edge.data?.alerta_id || "");
    const alerta = alertaPorId.get(alertaId);
    if (alerta) setExplicacao({ titulo: "Por que esse alerta foi gerado", alerta });
  }

  const filtrosAtivos = !!(termoBusca || filtroRegra || filtroConfianca || filtroDataInicio || filtroDataFim);

  return (
    <div className="space-y-5">
      {erro && <p className="text-sm text-claro-red">{erro}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <SectionTitle icone={AlertTriangle}>Fraude</SectionTitle>
          <div className="flex rounded-lg bg-gray-100 p-0.5 text-xs">
            <button
              onClick={() => setAba("casos")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                aba === "casos" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"
              }`}
            >
              Casos ({casos.length})
            </button>
            <button
              onClick={() => setAba("resolvidos")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                aba === "resolvidos" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"
              }`}
            >
              <History className="h-3 w-3" strokeWidth={2} />
              Resolvidos ({historico.length})
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filtroRegra}
            onChange={(e) => setFiltroRegra(e.target.value)}
            className="rounded-lg border border-gray-300 py-1.5 px-2 text-xs text-gray-600 focus:border-claro-red focus:outline-none"
          >
            <option value="">Todas as regras</option>
            {Object.entries(REGRA_META).map(([chave, meta]) => (
              <option key={chave} value={chave}>
                {meta.titulo}
              </option>
            ))}
          </select>
          <select
            value={filtroConfianca}
            onChange={(e) => setFiltroConfianca(e.target.value)}
            className="rounded-lg border border-gray-300 py-1.5 px-2 text-xs text-gray-600 focus:border-claro-red focus:outline-none"
          >
            <option value="">Todo risco</option>
            {Object.entries(CONFIANCA_META).map(([chave, meta]) => (
              <option key={chave} value={chave}>
                {meta.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filtroDataInicio}
            onChange={(e) => setFiltroDataInicio(e.target.value)}
            title="De"
            className="rounded-lg border border-gray-300 py-1.5 px-2 text-xs text-gray-600 focus:border-claro-red focus:outline-none"
          />
          <input
            type="date"
            value={filtroDataFim}
            onChange={(e) => setFiltroDataFim(e.target.value)}
            title="Até"
            className="rounded-lg border border-gray-300 py-1.5 px-2 text-xs text-gray-600 focus:border-claro-red focus:outline-none"
          />
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" strokeWidth={2} />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente…"
              className="w-56 rounded-lg border border-gray-300 py-1.5 pl-8 pr-7 text-xs focus:border-claro-red focus:outline-none"
            />
            {busca && (
              <button onClick={() => setBusca("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
          {filtrosAtivos && (
            <button
              onClick={() => {
                setFiltroRegra("");
                setFiltroConfianca("");
                setFiltroDataInicio("");
                setFiltroDataFim("");
                setBusca("");
              }}
              className="text-[11px] text-gray-400 hover:text-claro-red"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {aba === "casos" && (
        <p className="text-xs text-gray-400">
          Cada caso agrupa os alertas (de qualquer regra) que citam os mesmos clientes. Clique em{" "}
          <span className="font-medium text-gray-500">Ver grafo</span> num caso pra visualizar as identidades cruzadas
          envolvidas nele.
        </p>
      )}

      {carregando ? (
        <p className="text-sm text-gray-400">Carregando…</p>
      ) : aba === "casos" ? (
        casos.length === 0 ? (
          <p className="text-sm text-gray-400">{filtrosAtivos ? "Nenhum caso bate com esse filtro." : "Nenhum caso em aberto."}</p>
        ) : (
          <div className="space-y-2">
            {casos.map((caso) => {
              const clientes = clientesDoCaso(caso);
              const expandidoAtual = expandido.has(caso.id);
              const assumidoPorMim = caso.analista_id === usuarioNome;
              return (
                <div key={caso.id} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-1 flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${CONFIANCA_META[caso.maior_confianca].badge}`}>
                        {CONFIANCA_META[caso.maior_confianca].label}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_CASO_META[caso.status].badge}`}>
                        {STATUS_CASO_META[caso.status].label}
                        {assumidoPorMim && " · você"}
                        {!assumidoPorMim && caso.analista_id && ` · ${caso.analista_id}`}
                      </span>
                      {regrasDoCaso(caso).map((r) => (
                        <span key={r} className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500">
                          {REGRA_META[r]?.titulo || r}
                        </span>
                      ))}
                      {clientes.map((c) => {
                        const bloqueado = caso.bloqueados.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            onClick={() => alternarBloqueio(caso, c, !bloqueado)}
                            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                              bloqueado
                                ? "border-gray-300 bg-gray-100 text-gray-500 hover:border-green-600 hover:text-green-600"
                                : "border-claro-red/30 bg-claro-red-light text-claro-red hover:bg-claro-red hover:text-white"
                            }`}
                          >
                            {bloqueado ? <Unlock className="h-3 w-3" strokeWidth={2} /> : <Lock className="h-3 w-3" strokeWidth={2} />}
                            {c.nome}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {caso.status !== "revisado" && caso.status !== "descartado" && (
                        <>
                          {!caso.analista_id ? (
                            <button
                              onClick={() => assumirCaso(caso.id)}
                              title="Assumir investigação"
                              className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:border-claro-red hover:text-claro-red"
                            >
                              <UserPlus className="h-3.5 w-3.5" strokeWidth={2} />
                              Assumir
                            </button>
                          ) : assumidoPorMim ? (
                            <button
                              onClick={() => liberarCaso(caso.id)}
                              title="Liberar investigação"
                              className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:border-claro-red hover:text-claro-red"
                            >
                              <UserMinus className="h-3.5 w-3.5" strokeWidth={2} />
                              Liberar
                            </button>
                          ) : null}
                          <button
                            onClick={() => setResolvendo({ tipo: "caso", caso })}
                            title="Marcar caso como resolvido"
                            className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:border-green-600 hover:text-green-600"
                          >
                            <Check className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                          <button
                            onClick={() => descartarCaso(caso.id)}
                            title="Descartar caso (falso positivo)"
                            className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:border-claro-red hover:text-claro-red"
                          >
                            <X className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => alternarGrafo(caso.id)}
                        title="Ver grafo de identidades cruzadas deste caso"
                        className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium ${
                          grafoAberto === caso.id
                            ? "border-claro-red text-claro-red"
                            : "border-gray-200 text-gray-500 hover:border-claro-red hover:text-claro-red"
                        }`}
                      >
                        <ShieldAlert className="h-3.5 w-3.5" strokeWidth={2} />
                        Ver grafo
                      </button>
                      <button
                        onClick={() => alternarExpandido(caso.id)}
                        title={expandidoAtual ? "Recolher alertas" : `Ver ${caso.alertas.length} alerta(s)`}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] text-gray-500 hover:border-claro-red hover:text-claro-red"
                      >
                        {caso.alertas.length}
                        {expandidoAtual ? <ChevronUp className="h-3 w-3" strokeWidth={2} /> : <ChevronDown className="h-3 w-3" strokeWidth={2} />}
                      </button>
                    </div>
                  </div>

                  {grafoAberto === caso.id && (
                    <div className="mt-3 h-[320px] rounded-lg border border-gray-200 bg-white">
                      {carregandoGrafo ? (
                        <div className="flex h-full items-center justify-center text-sm text-gray-400">Carregando grafo…</div>
                      ) : nodes.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-gray-400">Sem grafo para este caso.</div>
                      ) : (
                        <ReactFlow
                          nodes={nodes}
                          edges={edges}
                          onNodeClick={onGrafoNodeClick}
                          onEdgeClick={onGrafoEdgeClick}
                          fitView
                          proOptions={{ hideAttribution: true }}
                        >
                          <Background gap={16} color="#f3f4f6" />
                          <Controls showInteractive={false} />
                        </ReactFlow>
                      )}
                      {grafo?.truncado && (
                        <p className="px-2 pb-1 text-[11px] text-amber-600">
                          Caso muito grande — mostrando só uma parte dos nós.
                        </p>
                      )}
                    </div>
                  )}

                  {expandidoAtual && (
                    <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-2">
                      {caso.alertas.map((a) => (
                        <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-claro-gray-light px-2.5 py-1.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium text-gray-600">{REGRA_META[a.regra]?.titulo || a.regra}</p>
                            <p className="line-clamp-1 text-xs text-gray-500">{a.explicacao}</p>
                          </div>
                          <span className="shrink-0 text-[11px] text-gray-400">{fmtDataHora(a.criado_em)}</span>
                          <div className="flex shrink-0 gap-1">
                            <button
                              onClick={() => setExplicacao({ titulo: "Por que esse alerta foi gerado", alerta: a })}
                              title="Ver evidência"
                              className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:border-claro-red hover:text-claro-red"
                            >
                              <Info className="h-3.5 w-3.5" strokeWidth={2} />
                            </button>
                            {a.status === "aberto" && (
                              <>
                                <button
                                  onClick={() => setResolvendo({ tipo: "alerta", alerta: a })}
                                  title="Marcar alerta como resolvido"
                                  className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:border-green-600 hover:text-green-600"
                                >
                                  <Check className="h-3.5 w-3.5" strokeWidth={2} />
                                </button>
                                <button
                                  onClick={() => descartarAlerta(a.id)}
                                  title="Descartar alerta (falso positivo)"
                                  className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:border-claro-red hover:text-claro-red"
                                >
                                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : historico.length === 0 ? (
        <p className="text-sm text-gray-400">{filtrosAtivos ? "Nenhum alerta bate com esse filtro." : "Nenhum alerta resolvido ainda."}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-gray-400">
                <th className="px-3 pb-2 pt-3">Risco de fraude</th>
                <th className="px-3 pb-2 pt-3">Regra</th>
                <th className="px-3 pb-2 pt-3">Envolvidos</th>
                <th className="px-3 pb-2 pt-3">Resolução</th>
                <th className="px-3 pb-2 pt-3">Resolvido</th>
                <th className="px-3 pb-2 pt-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {historico.map((a) => (
                <tr key={a.id} className="align-top hover:bg-claro-gray-light/60">
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${CONFIANCA_META[a.confianca].badge}`}>
                      {CONFIANCA_META[a.confianca].label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{REGRA_META[a.regra]?.titulo || a.regra}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex max-w-[220px] flex-wrap gap-1">
                      {clientesDoAlerta(a).map((c) => (
                        <span key={c.id} className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                          {c.nome}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="max-w-xs px-3 py-2.5 text-xs text-gray-600">
                    <span
                      className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] ${
                        STATUS_RESOLUCAO_META[a.status as "revisado" | "descartado"]?.badge || ""
                      }`}
                    >
                      {STATUS_RESOLUCAO_META[a.status as "revisado" | "descartado"]?.label || a.status}
                    </span>
                    {a.nota_resolucao && <p className="line-clamp-2 text-gray-600">{a.nota_resolucao}</p>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-gray-400">
                    {a.resolvido_em ? fmtDataHora(a.resolvido_em) : "—"}
                    {a.resolvido_por && <span className="block">por {a.resolvido_por}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => setExplicacao({ titulo: "Por que esse alerta foi gerado", alerta: a })}
                      title="Ver evidência"
                      className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:border-claro-red hover:text-claro-red"
                    >
                      <Info className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cursorHistorico && (
            <div className="border-t border-gray-100 p-2 text-center">
              <button
                onClick={() => carregarHistorico(true)}
                disabled={carregandoMais}
                className="text-xs text-claro-red hover:underline disabled:opacity-50"
              >
                {carregandoMais ? "carregando…" : "Carregar mais"}
              </button>
            </div>
          )}
        </div>
      )}

      {explicacao && <PainelExplicacao alerta={explicacao.alerta} onClose={() => setExplicacao(null)} />}
      {resolvendo && (
        <PopupResolucao
          resumo={resolvendo.tipo === "caso" ? `Caso com ${resolvendo.caso.alertas.length} alerta(s) em aberto.` : resolvendo.alerta.explicacao}
          onConfirmar={confirmarResolucao}
          onClose={() => setResolvendo(null)}
        />
      )}
    </div>
  );
}

// Popup exigido para marcar um alerta ou um caso inteiro como resolvido:
// registra o que foi investigado antes de tirar da fila — evita um clique
// silencioso sem nenhuma trilha do que de fato foi apurado.
function PopupResolucao({
  resumo,
  onConfirmar,
  onClose,
}: {
  resumo: string;
  onConfirmar: (nota: string) => Promise<void>;
  onClose: () => void;
}) {
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function confirmar() {
    if (!nota.trim()) return;
    setSalvando(true);
    try {
      await onConfirmar(nota.trim());
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 bg-claro-black px-5 py-4 text-white">
          <h3 className="flex items-center gap-2 font-semibold">
            <Check className="h-4 w-4 text-green-400" strokeWidth={2} />
            Marcar como resolvido
          </h3>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-sm text-gray-600">{resumo}</p>
          <label className="block text-xs font-medium text-gray-500">
            O que foi investigado? (obrigatório)
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={4}
              placeholder="Ex.: liguei para o cliente, confirmou que as linhas são dele mesmo, pediu por engano."
              className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm text-gray-800 focus:border-claro-red focus:outline-none"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 bg-claro-gray-light px-5 py-3">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={!nota.trim() || salvando}
            className="flex items-center gap-1.5 rounded-lg bg-claro-red px-3 py-1.5 text-sm font-medium text-white hover:bg-claro-red-dark disabled:opacity-50"
          >
            <Check className="h-4 w-4" strokeWidth={2} />
            {salvando ? "salvando…" : "Confirmar resolução"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Painel de explicação (camada de XAI): decompõe a evidência bruta por trás
// do alerta, nunca só um veredito. Para a Regra C, mostra a similaridade por
// feature, não só o número final.
const ROTULO_VALOR_POR_TIPO: Record<string, string> = {
  ip_origem: "IP",
  dispositivo_id: "Dispositivo",
};

function PainelExplicacao({ alerta, onClose }: { alerta: AlertaFraude; onClose: () => void }) {
  const porFeature = alerta.evidencia.por_feature as Record<string, number> | undefined;
  const tipoEvidencia = alerta.evidencia.tipo as string | undefined;
  const localizacaoIp = alerta.evidencia.localizacao as string | null | undefined;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 bg-claro-black px-5 py-4 text-white">
          <h3 className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="h-4 w-4 text-claro-red" strokeWidth={2} />
            Por que esse alerta foi gerado
          </h3>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-sm text-gray-700">{alerta.explicacao}</p>
          <div className="rounded-lg bg-claro-gray-light p-3">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Evidência bruta</p>
            <dl className="space-y-1 text-xs text-gray-600">
              {Object.entries(alerta.evidencia)
                .filter(([k]) => k !== "por_feature" && k !== "tipo" && k !== "localizacao")
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-gray-400">{k === "valor" ? ROTULO_VALOR_POR_TIPO[tipoEvidencia || ""] || k : k}</dt>
                    <dd className="text-right font-medium text-gray-700">
                      {k === "clientes"
                        ? (v as ClienteEvidencia[]).map((c) => c.nome).join(", ")
                        : Array.isArray(v)
                          ? v.join(", ")
                          : k === "valor" && tipoEvidencia === "ip_origem" && localizacaoIp
                            ? `${String(v)} (${localizacaoIp})`
                            : String(v)}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
          {porFeature && (
            <div className="rounded-lg bg-claro-gray-light p-3">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Similaridade por característica de estilo</p>
              <div className="space-y-1.5">
                {Object.entries(porFeature).map(([feature, valor]) => (
                  <div key={feature}>
                    <div className="flex justify-between text-[11px] text-gray-500">
                      <span>{feature.replaceAll("_", " ")}</span>
                      <span>{Math.round(valor * 100)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-200">
                      <div className="h-1.5 rounded-full bg-claro-red" style={{ width: `${Math.round(valor * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
