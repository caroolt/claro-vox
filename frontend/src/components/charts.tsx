import { useState } from "react";

// Paleta de status (semântica de urgência) — fixa, nunca reaproveitada como
// cor de série categórica. Ver Manual de aplicação de marcas Claro (cores
// institucionais) + paleta de acessibilidade validada para o painel.
export const STATUS_HEX: Record<string, string> = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
  neutral: "#ADAFAF", // cinza-Claro — estado sem urgência (em andamento/encerrado)
};

export const CAT_HEX = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

// Tooltip flutuante simples, posicionado em pixels dentro de um contêiner
// relative que NÃO recorta overflow (ver StackedBar — a barra em si precisa
// de overflow-hidden para os cantos arredondados, então o tooltip vive numa
// camada irmã por cima, sem ser cortado).
function Tooltip({ leftPct, children }: { leftPct: number; children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg"
      style={{ left: `${leftPct}%` }}
    >
      {children}
      <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
    </div>
  );
}

// Barra empilhada horizontal (part-to-whole) com legenda direta, tooltip por
// segmento e seleção por clique (usada para filtrar listas abaixo do gráfico).
export function StackedBar({
  segments,
  onSelect,
  selectedKey,
  emptyLabel = "Sem dados ainda",
}: {
  segments: Segment[];
  onSelect?: (key: string) => void;
  selectedKey?: string | null;
  emptyLabel?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const visiveis = segments.filter((s) => s.value > 0);

  if (total === 0) {
    return <p className="text-sm text-gray-400">{emptyLabel}</p>;
  }

  // Posição acumulada de cada segmento — usada só para ancorar o tooltip,
  // que fica numa camada acima da barra (não pode ficar dentro dela: a
  // barra usa overflow-hidden para os cantos arredondados, e isso cortaria
  // o tooltip).
  let acumulado = 0;
  const comOffset = visiveis.map((seg) => {
    const pct = (seg.value / total) * 100;
    const centro = acumulado + pct / 2;
    acumulado += pct;
    return { ...seg, pct, centro };
  });
  const hoveredSeg = comOffset.find((s) => s.key === hover);

  return (
    <div>
      <div className="relative pt-7">
        {hoveredSeg && (
          <Tooltip leftPct={hoveredSeg.centro}>
            {hoveredSeg.label}: {hoveredSeg.value} ({hoveredSeg.pct.toFixed(1)}%)
          </Tooltip>
        )}
        <div className="flex h-7 w-full gap-[2px] overflow-hidden rounded-full bg-white ring-1 ring-gray-100">
          {comOffset.map((seg) => {
            const selecionavel = !!onSelect;
            return (
              <button
                key={seg.key}
                type="button"
                onClick={() => onSelect?.(seg.key)}
                disabled={!selecionavel}
                onMouseEnter={() => setHover(seg.key)}
                onMouseLeave={() => setHover((h) => (h === seg.key ? null : h))}
                className="h-full transition-opacity"
                style={{
                  width: `${seg.pct}%`,
                  minWidth: 6,
                  backgroundColor: seg.color,
                  opacity: selectedKey && selectedKey !== seg.key ? 0.35 : 1,
                  cursor: selecionavel ? "pointer" : "default",
                }}
                aria-label={`${seg.label}: ${seg.value} (${seg.pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((seg) => {
          const pct = total > 0 ? (seg.value / total) * 100 : 0;
          const ativo = !selectedKey || selectedKey === seg.key;
          return (
            <button
              key={seg.key}
              type="button"
              onClick={() => onSelect?.(seg.key)}
              disabled={!onSelect || seg.value === 0}
              onMouseEnter={() => setHover(seg.key)}
              onMouseLeave={() => setHover((h) => (h === seg.key ? null : h))}
              className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-xs transition ${
                onSelect && seg.value > 0 ? "hover:bg-gray-50" : ""
              } ${ativo ? "" : "opacity-40"}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: seg.color }} />
              <span className="text-gray-600">{seg.label}</span>
              <span className="font-semibold tabular-nums text-gray-800">{seg.value}</span>
              <span className="tabular-nums text-gray-400">({pct.toFixed(0)}%)</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Meter — proporção única contra uma meta (ex.: taxa de transbordo), com
// marcador de meta interna. Preferido a um "donut de 2 fatias" (ver dataviz).
export function Meter({
  pct,
  bom,
  critico,
  meta,
}: {
  pct: number;
  /** limite (inclusive) até onde a cor é "good" */
  bom: number;
  /** acima deste limite a cor vira "critical"; entre bom e critico é "warning" */
  critico: number;
  /** marcador de meta interna, em % */
  meta?: number;
}) {
  const cor = pct <= bom ? STATUS_HEX.good : pct <= critico ? STATUS_HEX.warning : STATUS_HEX.critical;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${clamped}%`, backgroundColor: cor }}
        />
        {typeof meta === "number" && (
          <div
            className="absolute top-0 h-full w-[2px] bg-gray-500/60"
            style={{ left: `${Math.max(0, Math.min(100, meta))}%` }}
            title={`Meta interna: ${meta}%`}
          />
        )}
      </div>
      {typeof meta === "number" && (
        <div className="mt-1 flex justify-end">
          <span className="text-[10px] text-gray-400">meta interna: {meta}%</span>
        </div>
      )}
    </div>
  );
}
