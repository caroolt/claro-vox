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
  cliente_nome: string | null;
  tipo_cliente: string | null;
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
}
