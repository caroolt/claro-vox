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

// CompareBars — comparação lado a lado de poucas séries na mesma escala
// (ex.: NPS médio da IA × dos atendentes). Barras horizontais sobrepostas,
// escala fixa 0–max, com rótulo, valor e uma métrica secundária opcional.
export interface CompareItem {
  key: string;
  label: string;
  /** valor principal, plotado na barra (0–max) */
  value: number;
  color: string;
  /** texto auxiliar à direita (ex.: "12 respostas · índice 25") */
  sub?: string;
  /** quando true, mostra a barra vazia com uma mensagem de "sem dados" */
  vazio?: boolean;
}

export function CompareBars({
  items,
  max = 10,
  emptyLabel = "Sem respostas ainda",
}: {
  items: CompareItem[];
  max?: number;
  emptyLabel?: string;
}) {
  return (
    <div className="space-y-3">
      {items.map((it) => {
        const pct = it.vazio ? 0 : Math.max(0, Math.min(100, (it.value / max) * 100));
        return (
          <div key={it.key}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-medium text-gray-600">{it.label}</span>
              {it.vazio ? (
                <span className="text-gray-400">{emptyLabel}</span>
              ) : (
                <span className="text-gray-400">
                  <span className="text-sm font-bold tabular-nums text-gray-800">{it.value.toFixed(1)}</span>
                  <span className="text-gray-300"> / {max}</span>
                  {it.sub && <span className="ml-2">{it.sub}</span>}
                </span>
              )}
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: it.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Donut — distribuição parte-todo com o total no centro (ex.: sessões por
// estado). Preferido a mais uma barra empilhada quando o total em si já é
// uma métrica que vale a pena destacar visualmente.
export function DonutChart({
  segments,
  size = 132,
  thickness = 16,
  centerLabel,
}: {
  segments: Segment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const visiveis = segments.filter((s) => s.value > 0);

  let acumulado = 0;
  const arcos = visiveis.map((seg) => {
    const frac = total > 0 ? seg.value / total : 0;
    // Pequeno respiro entre fatias (2px de circunferência), como nos
    // donuts de referência — nunca deixa a fatia negativa quando é bem fina.
    const bruto = frac * circumference;
    const dash = Math.max(bruto - 2, 0);
    const arco = { ...seg, dash, offset: -acumulado, pct: frac * 100 };
    acumulado += bruto;
    return arco;
  });

  const destaque = hover ? arcos.find((a) => a.key === hover) : null;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#F4F4F3" strokeWidth={thickness} />
        {arcos.map((arco) => (
          <circle
            key={arco.key}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={arco.color}
            strokeWidth={thickness}
            strokeDasharray={`${arco.dash} ${circumference - arco.dash}`}
            strokeDashoffset={arco.offset}
            strokeLinecap="round"
            opacity={hover && hover !== arco.key ? 0.35 : 1}
            className="cursor-default transition-opacity"
            onMouseEnter={() => setHover(arco.key)}
            onMouseLeave={() => setHover((h) => (h === arco.key ? null : h))}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xl font-bold tabular-nums text-gray-900">
          {destaque ? destaque.value : total}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-gray-400">
          {destaque ? destaque.label : centerLabel}
        </span>
      </div>
    </div>
  );
}

// Lista ordenada com barra inline por item (ex.: sessões por canal) — mais
// legível que uma única barra empilhada quando há poucas categorias e vale
// a pena comparar os valores lado a lado.
export function RankedBars({
  segments,
  emptyLabel = "Sem dados ainda",
}: {
  segments: Segment[];
  emptyLabel?: string;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) {
    return <p className="text-sm text-gray-400">{emptyLabel}</p>;
  }
  const ordenado = [...segments].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const max = Math.max(...ordenado.map((s) => s.value));

  return (
    <div className="space-y-2.5">
      {ordenado.map((seg) => (
        <div key={seg.key}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-gray-600">{seg.label}</span>
            <span className="tabular-nums text-gray-400">
              <span className="font-semibold text-gray-800">{seg.value}</span>{" "}
              ({((seg.value / total) * 100).toFixed(0)}%)
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(seg.value / max) * 100}%`, backgroundColor: seg.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// Gauge radial — valor único contra uma escala fixa (ex.: nota média de NPS
// de 0 a 10). Usado lado a lado para comparar IA × atendentes humanos.
export function RadialMeter({
  value,
  max,
  color,
  size = 96,
  thickness = 10,
  vazio,
}: {
  value: number;
  max: number;
  color: string;
  size?: number;
  thickness?: number;
  vazio?: boolean;
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = vazio ? 0 : Math.max(0, Math.min(1, value / max));
  const dash = pct * circumference;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#F4F4F3" strokeWidth={thickness} />
        {!vazio && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        {vazio ? (
          <span className="text-[10px] text-gray-300">sem dados</span>
        ) : (
          <>
            <span className="text-xl font-bold tabular-nums text-gray-900">{value.toFixed(1)}</span>
            <span className="text-[10px] text-gray-300">/ {max}</span>
          </>
        )}
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
