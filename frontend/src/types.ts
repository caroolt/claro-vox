export type Canal = "whatsapp" | "site" | "app" | "voz";

export type Role = "admin" | "atendente";

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  role: Role;
}

export interface UsuarioAdmin extends Usuario {
  ativo: boolean;
  mfa_ativado: boolean;
  criado_em: string;
}

export interface LoginIniciado {
  etapa: "mfa" | "mfa_configuracao";
  login_token: string;
  otpauth_url?: string;
  mfa_qr_data_url?: string;
  mfa_secret?: string;
}

export interface LoginConcluido {
  token: string;
  usuario: Usuario;
}

export interface Cliente {
  id: string;
  nome: string;
  tipo_cliente: string;
  cpf_mascarado?: string | null;
}

export interface Mensagem {
  id: string;
  remetente: "cliente" | "vox" | "atendente";
  conteudo: string;
  timestamp: string;
  canal?: string | null;
}

export interface SessaoResumo {
  id: string;
  estado: string;
  criado_em: string;
  atualizado_em: string;
  protocolo: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  tipo_cliente: string | null;
  canal: string | null;
  ultima_intencao: any;
  jornada_status: string | null;
}

export interface Briefing {
  id: string;
  sessao_id: string;
  resumo_jornada: string;
  canais_utilizados: string;
  tom_emocional: string;
  motivo_transbordo: string;
  sugestao_resolucao: string;
  gerado_em: string;
  sessao_estado: string;
  protocolo: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  tipo_cliente: string | null;
  canal: string | null;
  atendente_id: string | null;
  assumido_em: string | null;
  encerrado_em: string | null;
  possivel_fraude: boolean;
}

export interface KnowledgeItem {
  id: string;
  titulo: string;
  conteudo: string;
  categoria: string;
  distancia?: number | null;
}

export interface Suggestions {
  contexto: string | null;
  itens: KnowledgeItem[];
}

export interface Metrics {
  sessoes_por_estado: Record<string, number>;
  taxa_transbordo_pct: number;
  tom_emocional: Record<string, number>;
  total_mensagens: number;
  taxa_fraude_pct: number;
  sessoes_por_canal: Record<string, number>;
  total_sessoes: number;
  total_transbordos: number;
  total_sessoes_fraude: number;
  nps: {
    ia: NpsResumo;
    atendente: NpsResumo;
  };
}

export interface NpsResumo {
  /** média geral das notas (0–10) */
  media: number;
  respostas: number;
  /** índice NPS clássico: % promotores (9–10) − % detratores (0–6), de -100 a 100 */
  indice: number;
}

export interface ClienteResumo {
  id: string;
  nome: string;
  tipo_cliente: string;
  data_cadastro: string;
  total_sessoes: number;
  total_transbordos: number;
  ultima_interacao: string | null;
}

export interface ClienteSessao {
  id: string;
  estado: string;
  criado_em: string;
  atualizado_em: string;
  protocolo: string | null;
  canal: string | null;
  ultima_intencao: any;
  jornada_status: string | null;
}

export interface ClienteBriefing {
  id: string;
  motivo_transbordo: string;
  tom_emocional: string;
  resumo_jornada: string;
  sugestao_resolucao: string;
  canais_utilizados: string;
  gerado_em: string;
  atendente_id: string | null;
  assumido_em: string | null;
  encerrado_em: string | null;
}

export interface Transcript {
  sessao: {
    id: string;
    estado: string;
    canal: string | null;
    criado_em: string;
    atualizado_em: string;
  };
  cliente: { rotulo: string; tipo_cliente: string | null };
  tom_predominante: string | null;
  briefing: {
    motivo_transbordo: string;
    tom_emocional: string;
    resumo_jornada: string;
    sugestao_resolucao: string;
    canais_utilizados: string;
  } | null;
  mensagens: { remetente: "cliente" | "vox" | "atendente"; conteudo: string; timestamp: string }[];
}

export interface AuditoriaEntry {
  id: string;
  ator: string;
  acao: string;
  recurso_id: string | null;
  timestamp: string;
}

export interface ClienteAlerta {
  cliente_id: string;
  hostil: boolean;
  urgente: boolean;
  chamados_semana: number;
  prioridade: boolean;
}

export interface Configuracao {
  chave: string;
  valor: number;
  descricao: string | null;
  atualizado_em: string | null;
  atualizado_por: string | null;
}

export type RegraFraude = "A_volume_cpf" | "B_dispositivo_ip" | "C_estilo_escrita";
export type ConfiancaFraude = "alta" | "media" | "baixa";

export interface AlertaFraude {
  id: string;
  regra: RegraFraude;
  clientes_ids: string[];
  evidencia: Record<string, unknown>;
  explicacao: string;
  confianca: ConfiancaFraude;
  status: "aberto" | "revisado" | "descartado";
  criado_em: string;
  resolvido_em?: string | null;
  resolvido_por?: string | null;
  nota_resolucao?: string | null;
  caso_id?: string | null;
}

export type StatusCaso = "aberto" | "em_investigacao" | "revisado" | "descartado";

// Um caso agrupa todos os alertas (de qualquer regra) que citam clientes em
// comum — a unidade de investigação da aba Fraude, não o alerta individual.
export interface CasoFraude {
  id: string;
  status: StatusCaso;
  analista_id: string | null;
  assumido_em: string | null;
  criado_em: string;
  atualizado_em: string;
  clientes_ids: string[];
  maior_confianca: ConfiancaFraude;
  alertas: AlertaFraude[];
  bloqueados: string[];
}

export interface PaginaHistoricoFraude {
  itens: AlertaFraude[];
  proximo_cursor: string | null;
}

// Filtros server-side aceitos por /v1/fraude/alertas, /alertas/historico e
// /casos — a aba Fraude não filtra mais em cima da lista inteira no navegador.
export interface FiltrosFraude {
  regra?: RegraFraude;
  confianca?: ConfiancaFraude;
  desde?: string;
  ate?: string;
  q?: string;
  cpf?: string;
  limit?: number;
}

export interface GrafoFraudeNo {
  id: string;
  nome: string;
  // "linha" = uma conta/contrato pré-pago do cliente (Regra A) — nó satélite,
  // não é uma identidade separada.
  tipo: "cliente" | "linha";
  bloqueado?: boolean;
}

export interface GrafoFraudeAresta {
  id: string;
  origem: string;
  destino: string;
  alerta_id: string;
  regra: RegraFraude;
  confianca: ConfiancaFraude;
  explicacao: string;
}

export interface GrafoFraude {
  nos: GrafoFraudeNo[];
  arestas: GrafoFraudeAresta[];
  truncado?: boolean;
}

export interface ClienteDetalhe {
  cliente: {
    id: string;
    nome: string;
    tipo_cliente: string;
    tem_cpf: boolean;
    telefone: string | null;
    data_cadastro: string;
    consentimento_ts: string | null;
    consentimento_versao: string | null;
    bloqueado: boolean;
    bloqueado_em: string | null;
    bloqueado_motivo: string | null;
    possivel_fraude: boolean;
  };
  acessibilidade: {
    modalidade_libras: boolean;
    leitor_de_tela: boolean;
    linguagem_simplificada: boolean;
  };
  resumo: {
    total_sessoes: number;
    total_transbordos: number;
    total_mensagens: number;
    ultima_interacao: string | null;
  };
  nps: {
    ia: { nota: number; comentario: string | null; criado_em: string } | null;
    atendente: { nota: number; comentario: string | null; criado_em: string } | null;
  };
  tom_emocional: Record<string, number>;
  sessoes: ClienteSessao[];
  briefings: ClienteBriefing[];
  fraude_alertas: AlertaFraude[];
}
