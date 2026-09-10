import type {
  Briefing,
  ClienteDetalhe,
  ClienteResumo,
  KnowledgeItem,
  Mensagem,
  Metrics,
  SessaoResumo,
  Suggestions,
  Transcript,
} from "./types";

export const CIV_URL = import.meta.env.VITE_CIV_URL || "http://localhost:4001";
export const ORCH_URL = import.meta.env.VITE_ORCH_URL || "http://localhost:4002";

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`${resp.status} ${resp.statusText}: ${body}`);
  }
  return resp.json();
}

// -------- Orquestrador --------
export const orchestrator = {
  coldstartStart: (canal: string, canal_conversa_id: string, mensagem_inicial?: string) =>
    req<{ sessao_id: string; estado: string; proxima_pergunta: string }>(
      `${ORCH_URL}/v1/orchestrator/coldstart/start`,
      { method: "POST", body: JSON.stringify({ canal, canal_conversa_id, mensagem_inicial }) }
    ),
  coldstartAnswer: (sessao_id: string, resposta: string) =>
    req<any>(`${ORCH_URL}/v1/orchestrator/coldstart/answer`, {
      method: "POST",
      body: JSON.stringify({ sessao_id, resposta }),
    }),
  coldstartReconhecer: (canal: string, cpf: string) =>
    req<any>(`${ORCH_URL}/v1/orchestrator/coldstart/reconhecer`, {
      method: "POST",
      body: JSON.stringify({ canal, cpf }),
    }),
  message: (sessao_id: string, canal: string, conteudo: string) =>
    req<any>(`${ORCH_URL}/v1/orchestrator/message`, {
      method: "POST",
      body: JSON.stringify({ sessao_id, canal, conteudo }),
    }),
  health: () => req<any>(`${ORCH_URL}/health`),
};

// -------- CIV --------
export const civ = {
  health: () => req<any>(`${CIV_URL}/health`),
  sessions: (ativas = true) => req<SessaoResumo[]>(`${CIV_URL}/v1/sessions?ativas=${ativas}`),
  sessionMessages: (id: string) => req<Mensagem[]>(`${CIV_URL}/v1/sessions/${id}/messages`),
  sessionContext: (id: string) => req<any>(`${CIV_URL}/v1/sessions/${id}/context`),
  // Transcrição anonimizada de uma sessão — base do PDF de conversa.
  sessionTranscript: (id: string) => req<Transcript>(`${CIV_URL}/v1/sessions/${id}/transcript`),
  // Sugestões de resposta (base de conhecimento) para o atendente humano.
  sessionSuggestions: (id: string) => req<Suggestions>(`${CIV_URL}/v1/sessions/${id}/suggestions`),
  handoffQueue: () => req<Briefing[]>(`${CIV_URL}/v1/handoff`),
  handoffDetail: (id: string) => req<Briefing>(`${CIV_URL}/v1/handoff/${id}`),
  handoffAssumir: (id: string, atendente_id: string) =>
    req<any>(`${CIV_URL}/v1/handoff/${id}/assumir`, { method: "POST", body: JSON.stringify({ atendente_id }) }),
  handoffEncerrar: (id: string) => req<any>(`${CIV_URL}/v1/handoff/${id}/encerrar`, { method: "POST" }),
  knowledge: () => req<KnowledgeItem[]>(`${CIV_URL}/v1/knowledge`),
  metrics: () => req<Metrics>(`${CIV_URL}/v1/metrics`),
  // Busca de clientes para o painel do atendente — `q` = nome/telefone
  // parcial, `cpf` = CPF completo (match exato por hash). Sem filtro,
  // devolve os clientes mais recentes.
  clientesBuscar: (params: { q?: string; cpf?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.cpf) qs.set("cpf", params.cpf);
    if (params.limit) qs.set("limit", String(params.limit));
    const sufixo = qs.toString() ? `?${qs}` : "";
    return req<ClienteResumo[]>(`${CIV_URL}/v1/clientes${sufixo}`);
  },
  clienteDetalhe: (id: string) => req<ClienteDetalhe>(`${CIV_URL}/v1/clientes/${id}`),
  excluirCliente: (id: string) => req<any>(`${CIV_URL}/v1/clientes/${id}`, { method: "DELETE" }),
  // Registra a nota de NPS enviada pelo cliente no simulador — alvo "ia"
  // (junto do transbordo) ou "atendente" (ao encerrar o atendimento humano).
  nps: (payload: {
    sessao_id: string;
    alvo: "ia" | "atendente";
    nota: number;
    comentario?: string;
    briefing_id?: string | null;
    atendente_id?: string | null;
  }) =>
    req<{ ok: boolean; nps_id: string }>(`${CIV_URL}/v1/nps`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  // Grava uma mensagem diretamente na sessão — usado pelo atendente humano
  // (remetente "atendente") no chat do painel, e pelo cliente quando a
  // sessão já está com atendimento humano (sem passar pelo Orquestrador/IA).
  enviarMensagem: (sessao_id: string, remetente: "atendente" | "cliente", canal: string, conteudo: string) =>
    req<{ mensagem_id: string; timestamp: string }>(`${CIV_URL}/v1/sessions/${sessao_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ remetente, canal, conteudo }),
    }),
};

export function wsBriefingUrl(): string {
  const u = new URL(CIV_URL);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws/briefing";
  return u.toString();
}
