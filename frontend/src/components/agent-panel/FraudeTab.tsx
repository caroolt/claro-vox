import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import { AlertTriangle, Check, Info, Lock, Search, ShieldAlert, Unlock, X } from "lucide-react";
import { civ, fraude } from "../../api";
import type { AlertaFraude, ConfiancaFraude, GrafoFraude } from "../../types";
import type { WsEvent } from "../../useBriefingSocket";
import { SectionTitle } from "./ui";
import { fmtDataHora } from "./meta";

interface ClienteEvidencia {
  id: string;
  nome: string;
}

const CONFIANCA_META: Record<ConfiancaFraude, { label: string; badge: string }> = {
  alta: { label: "Confiança alta", badge: "bg-red-100 text-red-700" },
  media: { label: "Confiança média", badge: "bg-amber-100 text-amber-800" },
  baixa: { label: "Confiança baixa", badge: "bg-gray-100 text-gray-600" },
};

const REGRA_META: Record<string, { titulo: string; rotuloAresta: string }> = {
  A_volume_cpf: { titulo: "Volume de linhas no mesmo CPF", rotuloAresta: "linha pré-paga" },
  B_dispositivo_ip: { titulo: "Dispositivo/IP compartilhado", rotuloAresta: "dispositivo/IP" },
  C_estilo_escrita: { titulo: "Estilo de escrita semelhante", rotuloAresta: "estilo semelhante" },
};

// Layout circular simples — o grafo é pequeno (só clientes com alerta em
// aberto, nunca a base inteira), então não precisa de um algoritmo de
// layout de força; um círculo já deixa os nós legíveis.
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

// Nome usado pra pré-preencher a busca quando o atendente clica em "focar no
// grafo" a partir da lista de alertas — poupa digitar de novo o que já está
// na explicação.
function clientesDoAlerta(alerta: AlertaFraude): ClienteEvidencia[] {
  return (alerta.evidencia.clientes as ClienteEvidencia[] | undefined) || [];
}

function nomeParaFoco(alerta: AlertaFraude): string {
  return clientesDoAlerta(alerta)[0]?.nome || "";
}

export function FraudeTab({
  onAbrirCliente,
  ultimoEvento,
}: {
  onAbrirCliente: (id: string) => void;
  ultimoEvento?: WsEvent | null;
}) {
  const [alertas, setAlertas] = useState<AlertaFraude[]>([]);
  const [grafo, setGrafo] = useState<GrafoFraude | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroRegra, setFiltroRegra] = useState("");
  const [filtroConfianca, setFiltroConfianca] = useState("");
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [explicacao, setExplicacao] = useState<{ titulo: string; alerta: AlertaFraude } | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      // Sequencial de propósito: /alertas roda o motor de regras e grava no
      // banco; /grafo só lê o que já está gravado. Buscar em paralelo cria
      // uma corrida onde /grafo pode ler antes de /alertas terminar de
      // gravar (mais visível na primeira carga, com a tabela ainda vazia),
      // mostrando alertas na lista mas "nenhuma identidade cruzada" no grafo.
      const a = await fraude.alertas();
      const g = await fraude.grafo();
      setAlertas(a);
      setGrafo(g);
      setErro(null);
    } catch {
      setErro("Não foi possível carregar os alertas de fraude.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  // Tempo real: a CIV avisa via WebSocket quando um alerta novo é gerado
  // (Regra A na hora da contratação, ou o job periódico que roda as Regras
  // B/C — ver deteccaoFraude.ts) ou quando alguém muda o status de um
  // alerta em outro painel. Sem isso, essa aba só atualizava se o admin
  // recarregasse manualmente.
  useEffect(() => {
    if (!ultimoEvento) return;
    if (ultimoEvento.type === "fraude.alerta.criado" || ultimoEvento.type === "fraude.alerta.atualizado") {
      carregar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultimoEvento]);

  async function atualizarStatus(id: string, status: "revisado" | "descartado") {
    await fraude.atualizarAlerta(id, status);
    setExplicacao(null);
    await carregar();
  }

  // Ação de baixo atrito pedida junto com o alerta vermelho: bloquear (ou
  // desbloquear) o cliente direto da lista, em um clique + confirmação, e já
  // marca o alerta como revisado — o admin não precisa repetir a ação em
  // dois lugares.
  async function alternarBloqueio(alertaId: string, cliente: ClienteEvidencia, bloquearAgora: boolean) {
    const pergunta = bloquearAgora
      ? `Bloquear "${cliente.nome}"? Ele não vai conseguir confirmar novas contratações até ser desbloqueado.`
      : `Desbloquear "${cliente.nome}"?`;
    if (!confirm(pergunta)) return;
    await civ.bloquearCliente(cliente.id, bloquearAgora, bloquearAgora ? "Bloqueado a partir de alerta de fraude" : undefined);
    if (bloquearAgora) await fraude.atualizarAlerta(alertaId, "revisado");
    await carregar();
  }

  const alertaPorId = useMemo(() => new Map(alertas.map((a) => [a.id, a])), [alertas]);
  const bloqueadoPorId = useMemo(
    () => new Map((grafo?.nos || []).filter((n) => n.tipo === "cliente").map((n) => [n.id, !!n.bloqueado])),
    [grafo]
  );

  // Filtros de regra/confiança/data — aplicados antes da busca por nome, e
  // compartilhados entre a tabela e o grafo (o grafo só desenha arestas dos
  // alertas que passam nesses filtros, não a base toda de alertas abertos).
  const alertasComFiltroBasico = useMemo(() => {
    return alertas.filter((a) => {
      if (filtroRegra && a.regra !== filtroRegra) return false;
      if (filtroConfianca && a.confianca !== filtroConfianca) return false;
      if (filtroDataInicio && a.criado_em < filtroDataInicio) return false;
      if (filtroDataFim && a.criado_em > `${filtroDataFim}T23:59:59`) return false;
      return true;
    });
  }, [alertas, filtroRegra, filtroConfianca, filtroDataInicio, filtroDataFim]);

  // A mesma busca do grafo filtra a tabela de alertas — antes só afetava o
  // grafo, deixando a lista sempre cheia mesmo depois de focar num caso.
  const termoBusca = busca.trim().toLowerCase();
  const alertasFiltrados = useMemo(() => {
    if (!termoBusca) return alertasComFiltroBasico;
    return alertasComFiltroBasico.filter((a) => clientesDoAlerta(a).some((c) => c.nome.toLowerCase().includes(termoBusca)));
  }, [alertasComFiltroBasico, termoBusca]);

  const idsAlertasVisiveis = useMemo(() => new Set(alertasComFiltroBasico.map((a) => a.id)), [alertasComFiltroBasico]);

  // A base pode ter milhões de clientes, mas o grafo nunca carrega a base
  // inteira (só quem já tem alerta em aberto) — ainda assim, com muitos
  // alertas simultâneos, catar um nó no olho não escala. A busca filtra
  // pelo nome e mantém os nós conectados a ele (ex.: buscar "Marcos" traz
  // junto as linhas pré-pagas dele), pra usar o grafo como zoom de uma
  // investigação específica, não como ferramenta de garimpo visual. Os
  // filtros de regra/confiança/data restringem as arestas ANTES da busca,
  // senão um cliente com muitos alertas (ex.: vários indícios fracos da
  // Regra C) arrasta de volta praticamente a base inteira pela expansão de
  // componente conectado.
  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    if (!grafo) return { nodes: [], edges: [] };

    const arestasComFiltroBasico = grafo.arestas.filter((a) => idsAlertasVisiveis.has(a.alerta_id));

    let idsVisiveis = new Set<string>();
    arestasComFiltroBasico.forEach((a) => {
      idsVisiveis.add(a.origem);
      idsVisiveis.add(a.destino);
    });

    if (termoBusca) {
      idsVisiveis = new Set(
        grafo.nos.filter((n) => idsVisiveis.has(n.id) && n.nome.toLowerCase().includes(termoBusca)).map((n) => n.id)
      );
      let mudou = true;
      while (mudou) {
        mudou = false;
        for (const a of arestasComFiltroBasico) {
          if (idsVisiveis.has(a.origem) && !idsVisiveis.has(a.destino)) {
            idsVisiveis.add(a.destino);
            mudou = true;
          }
          if (idsVisiveis.has(a.destino) && !idsVisiveis.has(a.origem)) {
            idsVisiveis.add(a.origem);
            mudou = true;
          }
        }
      }
    }

    const nosVisiveis = grafo.nos.filter((n) => idsVisiveis.has(n.id));
    const arestasVisiveis = arestasComFiltroBasico.filter((a) => idsVisiveis.has(a.origem) && idsVisiveis.has(a.destino));
    const posicoes = calcularPosicoes(nosVisiveis.map((n) => n.id));

    const nodes: Node[] = nosVisiveis.map((n) => ({
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

    const edges: Edge[] = arestasVisiveis.map((a) => ({
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
  }, [grafo, termoBusca, idsAlertasVisiveis]);

  function onNodeClick(_: unknown, node: Node) {
    if (node.data?.tipo === "cliente") onAbrirCliente(node.id);
  }

  function onEdgeClick(_: unknown, edge: Edge) {
    const alertaId = String(edge.data?.alerta_id || "");
    const alerta = alertaPorId.get(alertaId);
    if (alerta) setExplicacao({ titulo: "Por que esse alerta foi gerado", alerta });
  }

  if (carregando) return <p className="text-sm text-gray-400">Carregando…</p>;

  return (
    <div className="space-y-5">
      {erro && <p className="text-sm text-claro-red">{erro}</p>}

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle icone={ShieldAlert}>Grafo de identidades cruzadas</SectionTitle>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filtroRegra}
              onChange={(e) => setFiltroRegra(e.target.value)}
              className="rounded-lg border border-gray-300 py-1.5 px-2 text-xs text-gray-600 focus:border-claro-red focus:outline-none"
            >
              <option value="">Todas as regras</option>
              {Object.entries(REGRA_META).map(([chave, meta]) => (
                <option key={chave} value={chave}>{meta.titulo}</option>
              ))}
            </select>
            <select
              value={filtroConfianca}
              onChange={(e) => setFiltroConfianca(e.target.value)}
              className="rounded-lg border border-gray-300 py-1.5 px-2 text-xs text-gray-600 focus:border-claro-red focus:outline-none"
            >
              <option value="">Toda confiança</option>
              {Object.entries(CONFIANCA_META).map(([chave, meta]) => (
                <option key={chave} value={chave}>{meta.label}</option>
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
            {(filtroRegra || filtroConfianca || filtroDataInicio || filtroDataFim) && (
              <button
                onClick={() => {
                  setFiltroRegra("");
                  setFiltroConfianca("");
                  setFiltroDataInicio("");
                  setFiltroDataFim("");
                }}
                className="text-[11px] text-gray-400 hover:text-claro-red"
              >
                Limpar filtros
              </button>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" strokeWidth={2} />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar cliente ou linha no grafo…"
                className="w-64 rounded-lg border border-gray-300 py-1.5 pl-8 pr-7 text-xs focus:border-claro-red focus:outline-none"
              />
              {busca && (
                <button
                  onClick={() => setBusca("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="mb-2 text-xs text-gray-400">
          Clique num cliente para abrir o dossiê, ou numa ligação para ver a evidência por trás do alerta (linhas
          pré-pagas em cinza tracejado; dispositivo/IP em vermelho; estilo de escrita semelhante tracejado, indício
          fraco). Com muitos alertas abertos, use a busca em vez de procurar visualmente.
        </p>
        <div className="h-[420px] rounded-xl border border-gray-200 bg-white">
          {nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              {busca || filtroRegra || filtroConfianca || filtroDataInicio || filtroDataFim
                ? "Nenhum resultado para esse filtro."
                : "Nenhuma identidade cruzada em aberto no momento."}
            </div>
          ) : (
            <ReactFlow
              // `fitView` só enquadra a câmera na montagem do componente — como
              // o layout circular recalcula as posições do zero a cada filtro,
              // sem forçar uma remontagem aqui os nós filtrados ficam em
              // coordenadas fora do que a câmera já estava olhando, e a busca
              // parece não fazer nada. A key (conjunto de nós visíveis) força
              // o React a remontar o grafo sempre que o filtro muda, reaplicando
              // o `fitView`.
              key={nodes.map((n) => n.id).sort().join(",")}
              nodes={nodes}
              edges={edges}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={16} color="#f3f4f6" />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle icone={AlertTriangle}>Alertas em aberto</SectionTitle>
          <span className="text-[11px] text-gray-400">
            {termoBusca || filtroRegra || filtroConfianca || filtroDataInicio || filtroDataFim
              ? `${alertasFiltrados.length} de ${alertas.length} alertas (filtrado)`
              : `${alertas.length} alertas · ${alertas.filter((a) => a.confianca === "alta").length} de confiança alta`}
          </span>
        </div>
        {alertasFiltrados.length === 0 ? (
          <p className="text-sm text-gray-400">
            {termoBusca || filtroRegra || filtroConfianca || filtroDataInicio || filtroDataFim
              ? "Nenhum alerta bate com esse filtro."
              : "Nenhum alerta em aberto."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="px-3 pb-2 pt-3">Confiança</th>
                  <th className="px-3 pb-2 pt-3">Regra</th>
                  <th className="px-3 pb-2 pt-3">Envolvidos</th>
                  <th className="px-3 pb-2 pt-3">Explicação</th>
                  <th className="px-3 pb-2 pt-3">Quando</th>
                  <th className="px-3 pb-2 pt-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {alertasFiltrados.map((a) => (
                  <tr key={a.id} className="align-top hover:bg-claro-gray-light/60">
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${CONFIANCA_META[a.confianca].badge}`}>
                        {CONFIANCA_META[a.confianca].label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">{REGRA_META[a.regra]?.titulo || a.regra}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {clientesDoAlerta(a).map((c) => {
                          const bloqueado = bloqueadoPorId.get(c.id) || false;
                          return (
                            <button
                              key={c.id}
                              onClick={() => alternarBloqueio(a.id, c, !bloqueado)}
                              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                bloqueado
                                  ? "border-gray-300 bg-gray-100 text-gray-500 hover:border-green-600 hover:text-green-600"
                                  : "border-claro-red/30 bg-claro-red-light text-claro-red hover:bg-claro-red hover:text-white"
                              }`}
                            >
                              {bloqueado ? (
                                <Unlock className="h-3 w-3" strokeWidth={2} />
                              ) : (
                                <Lock className="h-3 w-3" strokeWidth={2} />
                              )}
                              {c.nome}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="max-w-xs px-3 py-2.5 text-xs text-gray-600">
                      <p className="line-clamp-2">{a.explicacao}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-gray-400">
                      {fmtDataHora(a.criado_em)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setBusca(nomeParaFoco(a))}
                          title="Focar no grafo"
                          className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:border-claro-red hover:text-claro-red"
                        >
                          <Search className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                        <button
                          onClick={() => setExplicacao({ titulo: "Por que esse alerta foi gerado", alerta: a })}
                          title="Ver evidência"
                          className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:border-claro-red hover:text-claro-red"
                        >
                          <Info className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                        <button
                          onClick={() => atualizarStatus(a.id, "revisado")}
                          title="Marcar como resolvido"
                          className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:border-green-600 hover:text-green-600"
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                        <button
                          onClick={() => atualizarStatus(a.id, "descartado")}
                          title="Descartar (falso positivo)"
                          className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:border-claro-red hover:text-claro-red"
                        >
                          <X className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {explicacao && <PainelExplicacao alerta={explicacao.alerta} onClose={() => setExplicacao(null)} />}
    </div>
  );
}

// Painel de explicação (camada de XAI): decompõe a evidência bruta por trás
// do alerta, nunca só um veredito. Para a Regra C, mostra a similaridade
// por feature, não só o número final.
function PainelExplicacao({ alerta, onClose }: { alerta: AlertaFraude; onClose: () => void }) {
  const porFeature = alerta.evidencia.por_feature as Record<string, number> | undefined;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
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
                .filter(([k]) => k !== "por_feature")
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-gray-400">{k}</dt>
                    <dd className="text-right font-medium text-gray-700">
                      {k === "clientes"
                        ? (v as ClienteEvidencia[]).map((c) => c.nome).join(", ")
                        : Array.isArray(v)
                          ? v.join(", ")
                          : String(v)}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
          {porFeature && (
            <div className="rounded-lg bg-claro-gray-light p-3">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Similaridade por característica de estilo
              </p>
              <div className="space-y-1.5">
                {Object.entries(porFeature).map(([feature, valor]) => (
                  <div key={feature}>
                    <div className="flex justify-between text-[11px] text-gray-500">
                      <span>{feature.replaceAll("_", " ")}</span>
                      <span>{Math.round(valor * 100)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-200">
                      <div
                        className="h-1.5 rounded-full bg-claro-red"
                        style={{ width: `${Math.round(valor * 100)}%` }}
                      />
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
