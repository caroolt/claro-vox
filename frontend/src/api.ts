import type {
  AlertaFraude,
  AuditoriaEntry,
  Briefing,
  ClienteAlerta,
  ClienteDetalhe,
  ClienteResumo,
  Configuracao,
  GrafoFraude,
  KnowledgeItem,
  LoginConcluido,
  LoginIniciado,
  Mensagem,
  Metrics,
  SessaoResumo,
  Suggestions,
  Transcript,
  Usuario,
  UsuarioAdmin,
} from "./types";

export const CIV_URL = import.meta.env.VITE_CIV_URL || "http://localhost:4001";
export const ORCH_URL = import.meta.env.VITE_ORCH_URL || "http://localhost:4002";

// Token do Painel do Atendente (Vox Briefing) — anexado em toda chamada à
// CIV assim que o login (senha + MFA) é concluído. O Simulador de Cliente e
// o Orquestrador não precisam dele; rotas públicas simplesmente o ignoram.
let authToken: string | null = null;
let onNaoAutorizado: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

// Chamado quando alguma requisição autenticada volta 401 — sessão expirada
// ou revogada; o App usa isso para derrubar o usuário de volta ao login.
export function onAuthExpirado(callback: () => void) {
  onNaoAutorizado = callback;
}

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts?.headers as any) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const resp = await fetch(url, { ...opts, headers });
  if (resp.status === 401 && authToken) onNaoAutorizado?.();
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`${resp.status} ${resp.statusText}: ${body}`);
  }
  return resp.json();
}

// -------- Orquestrador --------
export const orchestrator = {
  coldstartStart: (canal: string, canal_conversa_id: string, mensagem_inicial?: string, dispositivo_id?: string) =>
    req<{ sessao_id: string; estado: string; proxima_pergunta: string }>(
      `${ORCH_URL}/v1/orchestrator/coldstart/start`,
      { method: "POST", body: JSON.stringify({ canal, canal_conversa_id, mensagem_inicial, dispositivo_id }) }
    ),
  coldstartAnswer: (sessao_id: string, resposta: string) =>
    req<any>(`${ORCH_URL}/v1/orchestrator/coldstart/answer`, {
      method: "POST",
      body: JSON.stringify({ sessao_id, resposta }),
    }),
  coldstartReconhecer: (canal: string, cpf: string, dispositivo_id?: string) =>
    req<any>(`${ORCH_URL}/v1/orchestrator/coldstart/reconhecer`, {
      method: "POST",
      body: JSON.stringify({ canal, cpf, dispositivo_id }),
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
  // O atendente é sempre quem está logado (token) — não é mais passado no corpo.
  handoffAssumir: (id: string) => req<any>(`${CIV_URL}/v1/handoff/${id}/assumir`, { method: "POST" }),
  handoffEncerrar: (id: string) => req<any>(`${CIV_URL}/v1/handoff/${id}/encerrar`, { method: "POST" }),
  knowledge: () => req<KnowledgeItem[]>(`${CIV_URL}/v1/knowledge`),
  metrics: (desde?: string, ate?: string) =>
    req<Metrics>(`${CIV_URL}/v1/metrics${desde && ate ? `?desde=${desde}&ate=${ate}` : ""}`),
  // Log de ações sensíveis (login, MFA, CRUD de usuários, exclusão LGPD,
  // export de transcript etc.) — card de auditoria da Visão geral (admin).
  auditoria: () => req<AuditoriaEntry[]>(`${CIV_URL}/v1/auditoria`),
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
  // Alertas de comportamento (tendência a hostilidade/urgência, chamados na
  // semana) para os clientes que aparecem na fila de transbordo.
  clientesAlertas: (ids: string[]) => {
    const idsUnicos = [...new Set(ids)];
    if (!idsUnicos.length) return Promise.resolve<ClienteAlerta[]>([]);
    return req<ClienteAlerta[]>(`${CIV_URL}/v1/clientes/alertas?ids=${idsUnicos.join(",")}`);
  },
  clienteDetalhe: (id: string) => req<ClienteDetalhe>(`${CIV_URL}/v1/clientes/${id}`),
  excluirCliente: (id: string) => req<any>(`${CIV_URL}/v1/clientes/${id}`, { method: "DELETE" }),
  // Ação de baixo atrito a partir de um alerta de fraude: bloqueia (ou
  // desbloqueia) o cliente sem apagar nada do histórico.
  bloquearCliente: (id: string, bloqueado: boolean, motivo?: string) =>
    req<{ id: string; nome: string; bloqueado: boolean }>(`${CIV_URL}/v1/clientes/${id}/bloqueio`, {
      method: "PUT",
      body: JSON.stringify({ bloqueado, motivo }),
    }),
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

// -------- Autenticação do Painel do Atendente (login + MFA) --------
export const auth = {
  login: (email: string, senha: string) =>
    req<LoginIniciado>(`${CIV_URL}/v1/auth/login`, { method: "POST", body: JSON.stringify({ email, senha }) }),
  mfaVerificar: (login_token: string, codigo: string) =>
    req<LoginConcluido>(`${CIV_URL}/v1/auth/mfa/verificar`, {
      method: "POST",
      body: JSON.stringify({ login_token, codigo }),
    }),
  me: () => req<Usuario>(`${CIV_URL}/v1/auth/me`),
};

// -------- Gestão de atendentes/admins (aba "Atendentes", exclusiva do admin) --------
export const usuarios = {
  listar: () => req<UsuarioAdmin[]>(`${CIV_URL}/v1/usuarios`),
  criar: (payload: { nome: string; email: string; senha: string; role: "admin" | "atendente" }) =>
    req<UsuarioAdmin>(`${CIV_URL}/v1/usuarios`, { method: "POST", body: JSON.stringify(payload) }),
  atualizar: (
    id: string,
    payload: Partial<{
      nome: string;
      email: string;
      role: "admin" | "atendente";
      ativo: boolean;
      senha: string;
      resetar_mfa: boolean;
    }>
  ) => req<UsuarioAdmin>(`${CIV_URL}/v1/usuarios/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  excluir: (id: string) => req<{ ok: boolean }>(`${CIV_URL}/v1/usuarios/${id}`, { method: "DELETE" }),
};

// -------- Configurações (parâmetros editáveis, aba exclusiva do admin) --------
export const configuracoes = {
  listar: () => req<Configuracao[]>(`${CIV_URL}/v1/configuracoes`),
  atualizar: (chave: string, valor: number) =>
    req<Configuracao>(`${CIV_URL}/v1/configuracoes/${chave}`, { method: "PUT", body: JSON.stringify({ valor }) }),
};

// -------- Detecção de fraude cross-canal (aba "Fraude", exclusiva do admin) --------
export const fraude = {
  alertas: () => req<AlertaFraude[]>(`${CIV_URL}/v1/fraude/alertas`),
  historico: () => req<AlertaFraude[]>(`${CIV_URL}/v1/fraude/alertas/historico`),
  grafo: () => req<GrafoFraude>(`${CIV_URL}/v1/fraude/grafo`),
  atualizarAlerta: (id: string, status: "revisado" | "descartado", nota?: string) =>
    req<{ id: string; status: string }>(`${CIV_URL}/v1/fraude/alertas/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status, nota }),
    }),
};

export function wsBriefingUrl(): string {
  const u = new URL(CIV_URL);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws/briefing";
  return u.toString();
}
