import type { LucideIcon } from "lucide-react";
import { CANAL_META, ESTADO_META, TOM_META, TIPO_CLIENTE_META } from "./meta";

export function SectionTitle({ icone: Icone, children }: { icone: LucideIcon; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 font-medium text-gray-700">
      <Icone className="h-4 w-4 text-gray-400" strokeWidth={2} />
      {children}
    </h3>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  destaque,
  icone: Icone,
  children,
}: {
  label: string;
  value: string | number;
  sub?: string;
  destaque?: boolean;
  icone?: LucideIcon;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col rounded-xl border bg-white p-4 ${
        destaque ? "border-claro-red/30 ring-1 ring-claro-red/10" : "border-gray-200"
      }`}
    >
      <div className="flex items-center gap-2">
        {Icone && (
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
              destaque ? "bg-claro-red/10 text-claro-red" : "bg-claro-gray-light text-gray-500"
            }`}
          >
            <Icone className="h-3.5 w-3.5" strokeWidth={2.25} />
          </span>
        )}
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      </div>
      <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
      {children && <div className="mt-auto pt-3">{children}</div>}
    </div>
  );
}

export function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-gray-700">{value}</dd>
    </div>
  );
}

export function EstadoBadge({ estado, resolvido }: { estado: string; resolvido?: boolean }) {
  if (resolvido) {
    return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">resolvido</span>;
  }
  const m = ESTADO_META[estado];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${m?.badge || "bg-gray-100 text-gray-600"}`}>
      {m?.label || estado}
    </span>
  );
}

export function TomBadge({ tom }: { tom: string }) {
  const m = TOM_META[tom];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${m?.badge || TOM_META.neutro.badge}`}>
      {m?.label || tom}
    </span>
  );
}

export function TipoClienteBadge({ tipo }: { tipo: string | null | undefined }) {
  if (!tipo) return null;
  const m = TIPO_CLIENTE_META[tipo];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${m?.badge || "bg-gray-100 text-gray-600"}`}>
      {m?.label || tipo}
    </span>
  );
}

export function CanalTag({ canal, className = "" }: { canal: string | null | undefined; className?: string }) {
  const m = CANAL_META[canal || ""];
  const Icone = m?.icone;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {Icone && <Icone className="h-3 w-3 shrink-0" strokeWidth={2} />}
      {m?.label || canal || "?"}
    </span>
  );
}

// Botão-texto que abre o drawer de detalhe do cliente. Fica desabilitado
// (só texto) quando a linha não tem cliente_id (cliente não identificado).
export function NomeCliente({
  nome,
  clienteId,
  onAbrir,
  className = "",
}: {
  nome: string | null;
  clienteId: string | null;
  onAbrir: (id: string) => void;
  className?: string;
}) {
  const rotulo = nome || "Cliente não identificado";
  if (!clienteId) return <span className={`text-gray-800 ${className}`}>{rotulo}</span>;
  return (
    <button
      onClick={() => onAbrir(clienteId)}
      className={`text-left font-medium text-gray-800 underline decoration-gray-300 underline-offset-2 hover:text-claro-red hover:decoration-claro-red ${className}`}
    >
      {rotulo}
    </button>
  );
}
