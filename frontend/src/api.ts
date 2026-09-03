import type { Briefing, KnowledgeItem, Mensagem, Metrics, SessaoResumo } from "./types";

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
  handoffQueue: () => req<Briefing[]>(`${CIV_URL}/v1/handoff`),
  handoffDetail: (id: string) => req<Briefing>(`${CIV_URL}/v1/handoff/${id}`),
  handoffAssumir: (id: string, atendente_id: string) =>
    req<any>(`${CIV_URL}/v1/handoff/${id}/assumir`, { method: "POST", body: JSON.stringify({ atendente_id }) }),
  handoffEncerrar: (id: string) => req<any>(`${CIV_URL}/v1/handoff/${id}/encerrar`, { method: "POST" }),
  knowledge: () => req<KnowledgeItem[]>(`${CIV_URL}/v1/knowledge`),
  metrics: () => req<Metrics>(`${CIV_URL}/v1/metrics`),
  excluirCliente: (id: string) => req<any>(`${CIV_URL}/v1/clientes/${id}`, { method: "DELETE" }),
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
