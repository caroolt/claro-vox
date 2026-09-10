export type Canal = "whatsapp" | "site" | "app" | "voz";

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
  cliente_id: string | null;
  cliente_nome: string | null;
  tipo_cliente: string | null;
  canal: string | null;
  atendente_id: string | null;
  assumido_em: string | null;
  encerrado_em: string | null;
}

export interface KnowledgeItem {
  id: string;
  titulo: string;
  conteudo: string;
  categoria: string;
}

export interface Metrics {
  sessoes_por_estado: Record<string, number>;
  taxa_transbordo_pct: number;
  tom_emocional: Record<string, number>;
  total_mensagens: number;
  disponibilidade_slo_pct: number;
  latencia_p95_alvo_ms: number;
  sessoes_por_canal: Record<string, number>;
  total_sessoes: number;
  total_transbordos: number;
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
}
