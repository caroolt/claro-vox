import type { Segment } from "../charts";

// Chaves da paleta de status (STATUS_HEX em ../charts) — repetidas aqui como
// união de literais para não precisar importar o objeto só pelo tipo.
type StatusKey = "good" | "warning" | "serious" | "critical" | "neutral";

// Metadados de exibição por estado de sessão — a cor reflete a urgência
// operacional (o que precisa da atenção do atendente agora), não é uma
// paleta categórica solta.
export const ESTADO_META: Record<string, { label: string; status: StatusKey; badge: string }> = {
  COLD_START: { label: "Cold Start", status: "neutral", badge: "bg-gray-100 text-gray-600" },
  ATIVA: { label: "Ativa", status: "good", badge: "bg-green-100 text-green-700" },
  TRANSBORDO_PENDENTE: { label: "Transbordo pendente", status: "critical", badge: "bg-red-100 text-red-700" },
  EM_ATENDIMENTO_HUMANO: { label: "Com atendente humano", status: "warning", badge: "bg-amber-100 text-amber-800" },
  ENCERRADA: { label: "Encerrada", status: "neutral", badge: "bg-gray-100 text-gray-500" },
};
export const ESTADO_ORDEM = [
  "TRANSBORDO_PENDENTE",
  "EM_ATENDIMENTO_HUMANO",
  "ATIVA",
  "COLD_START",
  "ENCERRADA",
];

export const TOM_META: Record<string, { label: string; status: StatusKey; badge: string }> = {
  frustracao: { label: "Frustração", status: "critical", badge: "bg-red-100 text-red-700" },
  urgencia: { label: "Urgência", status: "warning", badge: "bg-amber-100 text-amber-800" },
  satisfacao: { label: "Satisfação", status: "good", badge: "bg-green-100 text-green-700" },
  neutro: { label: "Neutro", status: "neutral", badge: "bg-gray-100 text-gray-600" },
};
export const TOM_ORDEM = ["frustracao", "urgencia", "satisfacao", "neutro"];

export const CANAL_META: Record<string, { label: string; icone: string }> = {
  whatsapp: { label: "WhatsApp", icone: "💬" },
  site: { label: "Site", icone: "🌐" },
  app: { label: "App Claro", icone: "📱" },
  voz: { label: "Central de Voz", icone: "☎️" },
};
export const CANAL_ORDEM = ["whatsapp", "site", "app", "voz"];

export const TIPO_CLIENTE_META: Record<string, { label: string; badge: string }> = {
  ativo: { label: "Cliente ativo", badge: "bg-green-100 text-green-700" },
  prospeccao: { label: "Prospecção", badge: "bg-blue-100 text-blue-700" },
};

// Monta a lista de segmentos de um breakdown (Record<chave,valor>) na ordem
// fixa definida acima — chaves não previstas entram no fim, sem quebrar.
export function montarSegmentos<T extends { label: string }>(
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

// ---- Datas -----------------------------------------------------------------
export function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtData(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtRelativo(iso: string | null | undefined): string {
  if (!iso) return "sem interação";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.round(h / 24);
  return `há ${dias} d`;
}

// ---- Filtros da aba Operação ---------------------------------------------
export interface FiltrosOperacao {
  busca: string;
  estado: string | null;
  canal: string | null;
  tom: string | null;
}

export const FILTROS_VAZIOS: FiltrosOperacao = { busca: "", estado: null, canal: null, tom: null };

export function filtrosAtivos(f: FiltrosOperacao): boolean {
  return !!(f.busca.trim() || f.estado || f.canal || f.tom);
}

// Um termo de busca "parece um CPF" quando tem 11 dígitos depois de tirar
// pontuação — nesse caso resolvemos pelo backend (hash), senão é nome.
export function pareceCpf(termo: string): boolean {
  return termo.replace(/\D/g, "").length === 11;
}

export function tomDaSessao(ultimaIntencao: any): string | null {
  if (ultimaIntencao && typeof ultimaIntencao === "object") return ultimaIntencao.tom_emocional || null;
  return null;
}
