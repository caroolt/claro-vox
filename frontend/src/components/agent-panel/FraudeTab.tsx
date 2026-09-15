import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import { AlertTriangle, Check, Info, ShieldAlert, X } from "lucide-react";
import { fraude } from "../../api";
import type { AlertaFraude, ConfiancaFraude, GrafoFraude } from "../../types";
import { SectionTitle } from "./ui";
import { fmtDataHora } from "./meta";

const CONFIANCA_META: Record<ConfiancaFraude, { label: string; badge: string }> = {
  alta: { label: "Confiança alta", badge: "bg-red-100 text-red-700" },
  media: { label: "Confiança média", badge: "bg-amber-100 text-amber-800" },
  baixa: { label: "Confiança baixa", badge: "bg-gray-100 text-gray-600" },
};

const REGRA_META: Record<string, string> = {
  A_volume_cpf: "Volume de linhas no mesmo CPF",
  B_dispositivo_ip: "Dispositivo/IP compartilhado",
  C_estilo_escrita: "Estilo de escrita semelhante",
};

// Layout circular simples — o grafo é pequeno (só clientes envolvidos em
// alertas em aberto, nunca a base inteira), então não precisa de um
// algoritmo de layout de força; um círculo já deixa os nós legíveis.
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

export function FraudeTab({ onAbrirCliente }: { onAbrirCliente: (id: string) => void }) {
  const [alertas, setAlertas] = useState<AlertaFraude[]>([]);
  const [grafo, setGrafo] = useState<GrafoFraude | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [explicacao, setExplicacao] = useState<{ titulo: string; alerta: AlertaFraude } | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const [a, g] = await Promise.all([fraude.alertas(), fraude.grafo()]);
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

  async function atualizarStatus(id: string, status: "revisado" | "descartado") {
    await fraude.atualizarAlerta(id, status);
    setExplicacao(null);
    await carregar();
  }

  const alertaPorId = useMemo(() => new Map(alertas.map((a) => [a.id, a])), [alertas]);

  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    if (!grafo) return { nodes: [], edges: [] };
    const posicoes = calcularPosicoes(grafo.nos.map((n) => n.id));
    const idsComAlertaVolume = new Set(grafo.alertas_volume.flatMap((a) => a.clientes_ids));

    const nodes: Node[] = grafo.nos.map((n) => ({
      id: n.id,
      position: posicoes[n.id],
      data: { label: n.nome },
      style: {
        borderRadius: 10,
        border: idsComAlertaVolume.has(n.id) ? "2px solid #E4002B" : "1px solid #d1d5db",
        background: idsComAlertaVolume.has(n.id) ? "#FEF2F2" : "#fff",
        fontSize: 12,
        padding: 8,
      },
    }));

    const edges: Edge[] = grafo.arestas.map((a) => ({
      id: a.id,
      source: a.origem,
      target: a.destino,
      data: { alerta_id: a.alerta_id },
      label: a.regra === "B_dispositivo_ip" ? "dispositivo/IP" : "estilo semelhante",
      animated: a.confianca === "alta",
      style: {
        stroke: a.confianca === "alta" ? "#E4002B" : "#9ca3af",
        strokeDasharray: a.regra === "C_estilo_escrita" ? "5 4" : undefined,
      },
      labelStyle: { fontSize: 10, fill: "#6b7280" },
    }));

    return { nodes, edges };
  }, [grafo]);

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
        <SectionTitle icone={ShieldAlert}>Grafo de identidades cruzadas</SectionTitle>
        <p className="mb-2 text-xs text-gray-400">
          Clique num cliente para abrir o dossiê, ou numa ligação para ver a evidência por trás do alerta (linha
          contínua = dispositivo/IP compartilhado; tracejada = estilo de escrita semelhante, indício fraco).
        </p>
        <div className="h-[420px] rounded-xl border border-gray-200 bg-white">
          {nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              Nenhuma identidade cruzada em aberto no momento.
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodeClick={(_, node) => onAbrirCliente(node.id)}
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
        <SectionTitle icone={AlertTriangle}>Alertas em aberto</SectionTitle>
        <div className="mt-2 space-y-2">
          {alertas.length === 0 && <p className="text-sm text-gray-400">Nenhum alerta em aberto.</p>}
          {alertas.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 p-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${CONFIANCA_META[a.confianca].badge}`}>
                    {CONFIANCA_META[a.confianca].label}
                  </span>
                  <span className="text-[11px] text-gray-400">{REGRA_META[a.regra] || a.regra}</span>
                  <span className="text-[11px] text-gray-300">· {fmtDataHora(a.criado_em)}</span>
                </div>
                <p className="text-sm text-gray-700">{a.explicacao}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => setExplicacao({ titulo: "Por que esse alerta foi gerado", alerta: a })}
                  title="Ver evidência"
                  className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:border-claro-red hover:text-claro-red"
                >
                  <Info className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
                <button
                  onClick={() => atualizarStatus(a.id, "revisado")}
                  title="Marcar como revisado"
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
            </div>
          ))}
        </div>
      </section>

      {explicacao && <PainelExplicacao alerta={explicacao.alerta} onClose={() => setExplicacao(null)} />}
    </div>
  );
}

// Painel de explicação (camada de XAI): decompõe a evidência bruta por trás
// do alerta — nunca só um veredito. Para a Regra C, mostra a similaridade
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
                      {Array.isArray(v) ? v.join(", ") : String(v)}
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
