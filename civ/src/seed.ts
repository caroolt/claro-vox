import "dotenv/config";
import { pool } from "./db";
import { embed } from "./embedding";
import { hashCpf } from "./crypto";
import { gerarSegredoMfa, hashSenha } from "./auth";

// Usuários de demonstração do Painel do Atendente (Vox Briefing) — um de
// cada role, para demonstrar o RBAC. Senha e segredo MFA em texto aberto
// aqui são só para o ambiente local do MVP (ver aviso no README).
const USUARIOS_DEMO = [
  { nome: "Ana Torres (Admin)", email: "admin@clarovox.com", senha: "ClaroVox@Admin1", role: "admin" as const },
  {
    nome: "Bruno Lima (Atendente)",
    email: "atendente@clarovox.com",
    senha: "ClaroVox@Atendente1",
    role: "atendente" as const,
  },
];

// Dados fictícios de demonstração — planos ilustrativos para o MVP acadêmico,
// não refletem o portfólio comercial real da Claro. Cobre todas as
// categorias que o motor de regras (nlu.py) reconhece, para que o
// Orquestrador tenha algo relevante pra citar em qualquer assunto, em vez
// de cair sempre na mesma frase fixa por categoria.
const KNOWLEDGE_BASE = [
  // ---- Planos móveis e combos -------------------------------------------
  {
    titulo: "Plano Controle 5GB",
    categoria: "plano",
    conteudo: "Plano Controle 5GB: 5GB de internet, ligações ilimitadas para qualquer operadora, WhatsApp ilimitado sem consumir franquia. Indicado para quem usa pouco dado no dia a dia.",
  },
  {
    titulo: "Plano Controle 15GB",
    categoria: "plano",
    conteudo: "Plano Controle 15GB: 15GB de internet, ligações ilimitadas para qualquer operadora, WhatsApp ilimitado sem consumir franquia. Ideal para quem usa o celular no dia a dia sem grande consumo de vídeo.",
  },
  {
    titulo: "Plano Controle 30GB",
    categoria: "plano",
    conteudo: "Plano Controle 30GB: 30GB de internet, ligações ilimitadas, WhatsApp e redes sociais sem consumir franquia. Para quem assiste vídeo com moderação e usa bastante aplicativo de mapa e streaming de música.",
  },
  {
    titulo: "Plano Pós Ilimitado 60GB",
    categoria: "plano",
    conteudo: "Plano Pós Ilimitado 60GB: 60GB de internet de alta velocidade, ligações e SMS ilimitados, inclui acesso a aplicativos de streaming em parceria. Indicado para quem consome bastante vídeo e redes sociais.",
  },
  {
    titulo: "Plano Pós Ilimitado 120GB Premium",
    categoria: "plano",
    conteudo: "Plano Pós Ilimitado 120GB Premium: 120GB de internet de alta velocidade, ligações e SMS ilimitados, dois aplicativos de streaming de vídeo incluídos e prioridade de rede em eventos. Para quem faz videochamada e joga online com frequência.",
  },
  {
    titulo: "Plano Família Compartilhado 100GB",
    categoria: "plano",
    conteudo: "Plano Família Compartilhado 100GB: franquia de 100GB dividida entre até 4 linhas, ligações ilimitadas entre as linhas do grupo, cada linha adicional com desconto progressivo.",
  },
  {
    titulo: "Plano Internet Fibra 500 Mega residencial",
    categoria: "plano",
    conteudo: "Plano Internet Fibra 500 Mega: internet residencial via fibra óptica com 500 Mega de velocidade, Wi-Fi 6 incluso no roteador, sem limite de dados. Instalação em até 5 dias úteis após a contratação.",
  },
  {
    titulo: "Plano Internet Fibra 1 Giga residencial",
    categoria: "plano",
    conteudo: "Plano Internet Fibra 1 Giga: internet residencial via fibra óptica com 1 Giga de velocidade, ideal para várias pessoas usando ao mesmo tempo, streaming em 4K e home office. Wi-Fi mesh disponível como upgrade opcional.",
  },
  {
    titulo: "Combo TV + Internet",
    categoria: "plano",
    conteudo: "Combo TV + Internet: une o plano de fibra residencial a um pacote de TV por assinatura com mais de 80 canais, incluindo canais fechados de esporte e filmes. Sai mais barato que contratar os dois serviços separados.",
  },
  {
    titulo: "Pacote de roaming internacional",
    categoria: "plano",
    conteudo: "Pacote de roaming internacional: franquia de dados e minutos para uso em outros países, ativado por período (7, 15 ou 30 dias). Precisa ser contratado antes da viagem pelo app ou site.",
  },

  // ---- Fatura e cobrança --------------------------------------------------
  {
    titulo: "Como funciona a 2ª via de fatura",
    categoria: "fatura",
    conteudo: "A 2ª via de fatura fica disponível no app Claro, no site ou por aqui mesmo pelo Vox, sempre que a fatura original for extraviada ou não chegar por e-mail/SMS. O link enviado tem validade de 7 dias.",
  },
  {
    titulo: "Consulta de fatura e detalhamento de serviços",
    categoria: "fatura",
    conteudo: "A consulta de fatura mostra o valor total, a data de vencimento e o detalhamento por serviço (plano, linhas adicionais, pacotes avulsos e eventuais cobranças de uso fora da franquia).",
  },
  {
    titulo: "Fatura em atraso: juros e multa",
    categoria: "fatura",
    conteudo: "Fatura em atraso tem multa de 2% mais juros de mora de 1% ao mês sobre o valor não pago, a partir do primeiro dia após o vencimento. O pagamento pode ser feito a qualquer momento sem precisar renegociar.",
  },
  {
    titulo: "Política de cobrança contestada",
    categoria: "fatura",
    conteudo: "Cobranças contestadas são verificadas automaticamente contra o histórico de faturas; quando a verificação automática não resolve, o atendimento é transferido a um atendente humano com o resumo completo da jornada.",
  },
  {
    titulo: "Cobrança duplicada na fatura",
    categoria: "fatura",
    conteudo: "Cobrança duplicada costuma acontecer quando um serviço avulso (como um pacote extra de dados) é contratado duas vezes no mesmo ciclo. O estorno do valor em duplicidade é feito na fatura seguinte, ou como crédito imediato quando o cliente já pagou.",
  },
  {
    titulo: "Débito automático: como ativar ou cancelar",
    categoria: "fatura",
    conteudo: "O débito automático pode ser ativado ou cancelado a qualquer momento pelo app Claro, na seção 'Formas de pagamento', sem custo adicional. A mudança vale a partir da próxima fatura, a atual já emitida não é afetada.",
  },

  // ---- Suporte técnico -----------------------------------------------------
  {
    titulo: "Diagnóstico de sem internet",
    categoria: "suporte_tecnico",
    conteudo: "Para problemas de internet, o sistema verifica primeiro se há instabilidade confirmada na região do cliente; se não houver, orienta reiniciar o roteador e testar novamente antes de acionar uma visita técnica.",
  },
  {
    titulo: "Internet lenta: passos de diagnóstico",
    categoria: "suporte_tecnico",
    conteudo: "Internet lenta costuma ser resolvida testando a velocidade com o cabo de rede (sem Wi-Fi) para isolar o problema, reiniciando o roteador e verificando se há muitos aparelhos conectados ao mesmo tempo consumindo a franquia de banda.",
  },
  {
    titulo: "Sem sinal de TV: reinicialização do decodificador",
    categoria: "suporte_tecnico",
    conteudo: "Sem sinal de TV geralmente se resolve desligando o decodificador da tomada por 30 segundos e ligando de novo, deixando religar sozinho (pode levar até 3 minutos). Se persistir, pode ser instabilidade no sinal da região.",
  },
  {
    titulo: "App Claro não abre ou trava",
    categoria: "suporte_tecnico",
    conteudo: "Quando o app Claro não abre ou trava, geralmente resolve desinstalar e reinstalar a versão mais recente da loja de aplicativos, ou limpar o cache do app nas configurações do celular.",
  },
  {
    titulo: "Sinal fraco em área rural",
    categoria: "suporte_tecnico",
    conteudo: "Em áreas rurais com sinal fraco, o time técnico verifica a cobertura da torre mais próxima e pode indicar um repetidor de sinal residencial como solução, já que a instalação de nova infraestrutura tem prazo mais longo.",
  },
  {
    titulo: "Wi-Fi não conecta",
    categoria: "suporte_tecnico",
    conteudo: "Quando o Wi-Fi não conecta em nenhum aparelho, o primeiro passo é reiniciar o roteador; se o problema for só em um aparelho específico, o ideal é esquecer a rede salva e conectar de novo digitando a senha.",
  },

  // ---- Visitas técnicas ------------------------------------------------
  {
    titulo: "Reagendamento de visita técnica",
    categoria: "visita_tecnica",
    conteudo: "Visitas técnicas já agendadas podem ser reagendadas informando uma nova data e horário; a nova visita é confirmada e a anterior liberada automaticamente na agenda do time de campo.",
  },
  {
    titulo: "Janela de horário das visitas técnicas",
    categoria: "visita_tecnica",
    conteudo: "As visitas técnicas são agendadas em janelas de 4 horas (manhã ou tarde), e o cliente recebe um aviso por SMS ou WhatsApp cerca de 30 minutos antes da chegada do técnico.",
  },

  // ---- Troca de plano e titularidade ------------------------------------
  {
    titulo: "Como trocar de plano",
    categoria: "alterar_plano",
    conteudo: "A troca de plano pode ser feita a qualquer momento; upgrades (mais franquia) valem imediatamente com valor proporcional na fatura atual, enquanto downgrades (menos franquia) valem a partir do próximo ciclo de faturamento.",
  },
  {
    titulo: "Troca de titularidade da linha",
    categoria: "alterar_plano",
    conteudo: "A troca de titularidade exige documento de identidade do novo titular e do titular atual, e pode ser feita em loja física ou pelo app mediante confirmação de identidade em vídeo.",
  },
  {
    titulo: "Portabilidade numérica",
    categoria: "alterar_plano",
    conteudo: "A portabilidade numérica (trazer o número de outra operadora) leva em média 3 dias úteis, não tem custo e não interrompe o funcionamento da linha durante o processo.",
  },

  // ---- Cancelamento e dívida ---------------------------------------------
  {
    titulo: "Política de cancelamento e fidelidade",
    categoria: "cancelamento",
    conteudo: "Cancelamentos dentro do período de fidelidade (geralmente 12 meses após ganhar um aparelho ou desconto promocional) têm multa proporcional aos meses restantes; fora da fidelidade, o cancelamento é sem custo.",
  },
  {
    titulo: "Negociação de dívida em atraso",
    categoria: "divida",
    conteudo: "Débitos em atraso podem ser parcelados em até 6 vezes sem entrada, ou quitados à vista com desconto de até 20% nos juros acumulados, dependendo do tempo de atraso.",
  },
  {
    titulo: "Consequências de não pagar a fatura",
    categoria: "divida",
    conteudo: "Faturas não pagas após 30 dias podem gerar suspensão temporária da linha, e após 60 dias o nome do cliente pode ser incluído em órgãos de proteção ao crédito (SPC/Serasa), salvo acordo de negociação em andamento.",
  },

  // ---- Segurança e geral --------------------------------------------------
  {
    titulo: "Perda ou roubo do aparelho: bloqueio de linha",
    categoria: "faq",
    conteudo: "Em caso de perda ou roubo, a linha pode ser bloqueada imediatamente pelo app, site ou central telefônica, evitando uso indevido; o desbloqueio ou a emissão de um novo chip é feito depois que o cliente recupera ou substitui o aparelho.",
  },
  {
    titulo: "Como funciona o Cold Start",
    categoria: "faq",
    conteudo: "O Claro Vox identifica o cliente na primeira interação perguntando se já é cliente, o nome e o CPF ou telefone, e depois mantém esse reconhecimento em qualquer canal (WhatsApp, Site, App) sem precisar repetir os dados.",
  },
  {
    titulo: "Quando o atendimento passa para um humano",
    categoria: "faq",
    conteudo: "O atendimento é transferido para um atendente humano quando o cliente pede explicitamente, quando o Vox detecta frustração forte na conversa, ou quando uma cobrança contestada não é resolvida automaticamente após uma explicação.",
  },
];

const CANAIS = [
  { nome: "whatsapp", tipo_adapter: "whatsapp-business-api" },
  { nome: "site", tipo_adapter: "web" },
  { nome: "app", tipo_adapter: "mobile" },
  { nome: "voz", tipo_adapter: "central-voz" },
];

const ATENDENTE_DEMO_NOME = USUARIOS_DEMO[1].nome;

// ---------------------------------------------------------------------
// Clientes de demonstração com histórico completo (sessões, mensagens,
// intenções, transbordos e NPS) — para o Vox Briefing já abrir com o
// dashboard cheio (métricas, fila de transbordo, alertas de comportamento,
// auditoria) em vez de vazio. Datas são relativas a "agora" (dias/minutos
// atrás), não fixas, para continuarem fazendo sentido em qualquer dia que o
// seed for rodado.
// ---------------------------------------------------------------------

interface MensagemSeed {
  remetente: "cliente" | "vox" | "atendente";
  conteudo: string;
  minutosDepois: number;
  categoria?: string;
  tom?: string;
}

interface NpsSeed {
  alvo: "ia" | "atendente";
  nota: number;
  comentario?: string;
  minutosDepois: number;
}

interface BriefingSeed {
  motivo_transbordo: string;
  tom_emocional: string;
  resumo_jornada: string;
  sugestao_resolucao: string;
  atendenteId?: string | null;
  assumidoMinutosDepois?: number;
  encerradoMinutosDepois?: number;
}

interface SessaoSeed {
  canal: string;
  diasAtras: number;
  estado: "COLD_START" | "ATIVA" | "TRANSBORDO_PENDENTE" | "EM_ATENDIMENTO_HUMANO" | "ENCERRADA";
  jornadaStatus: string;
  mensagens: MensagemSeed[];
  briefing?: BriefingSeed;
  nps?: NpsSeed[];
}

interface ClienteSeed {
  nome: string;
  tipoCliente: "ativo" | "prospeccao";
  cpf?: string;
  telefone?: string;
  acessibilidade?: Partial<{ modalidade_libras: boolean; leitor_de_tela: boolean; linguagem_simplificada: boolean }>;
  sessoes: SessaoSeed[];
}

// Fernanda liga repetidamente na mesma semana sobre a mesma cobrança
// contestada — demonstra o alerta de prioridade (muitos chamados na semana)
// junto com o de tendência a hostilidade (tom de frustração recorrente).
function sessaoCobrancaFernanda(diasAtras: number, resolvida: boolean, numeroChamada: number): SessaoSeed {
  const reclamacao =
    numeroChamada === 1
      ? "voces sao uns incompetentes, cobraram um valor que eu nao reconheco na fatura"
      : `que atendimento de merda, essa e a ${numeroChamada}a vez que ligo sobre a mesma cobranca indevida`;
  const mensagens: MensagemSeed[] = [
    {
      remetente: "cliente",
      conteudo: reclamacao,
      minutosDepois: 0,
      categoria: "atendimento/cobranca_contestada",
      tom: "hostil",
    },
    {
      remetente: "vox",
      conteudo:
        "Não consigo te ajudar com isso. Estou te transferindo para um atendente! Antes disso, de 0 a 10, o quanto você recomendaria o atendimento do assistente virtual?",
      minutosDepois: 1,
    },
  ];
  if (resolvida) {
    mensagens.push(
      { remetente: "atendente", conteudo: "Boa tarde, vi aqui sua cobrança contestada, vou verificar agora.", minutosDepois: 20 },
      {
        remetente: "atendente",
        conteudo: "Identifiquei o erro no sistema de faturamento e já estornei o valor cobrado indevidamente.",
        minutosDepois: 35,
      },
      {
        remetente: "cliente",
        conteudo: "ok, obrigada",
        minutosDepois: 36,
        categoria: "atendimento/cobranca_contestada",
        tom: "neutro",
      }
    );
  }
  return {
    canal: numeroChamada % 2 === 0 ? "whatsapp" : "site",
    diasAtras,
    estado: resolvida ? "ENCERRADA" : "TRANSBORDO_PENDENTE",
    jornadaStatus: resolvida ? "RESOLVIDO" : "AGUARDANDO_TRANSBORDO",
    mensagens,
    briefing: {
      motivo_transbordo: "cliente demonstrou comportamento hostil (xingamento/ofensa) na mensagem",
      tom_emocional: "hostil",
      resumo_jornada: `Cliente Fernanda Alves, intenção: atendimento/cobranca_contestada. Última mensagem: "${reclamacao}".`,
      sugestao_resolucao: "Verificar histórico de faturas do cliente e cobranças em duplicidade antes de responder.",
      atendenteId: resolvida ? ATENDENTE_DEMO_NOME : null,
      assumidoMinutosDepois: resolvida ? 18 : undefined,
      encerradoMinutosDepois: resolvida ? 40 : undefined,
    },
    nps: resolvida
      ? [
          { alvo: "ia", nota: 3, comentario: "o robo nao resolveu, precisei falar com atendente", minutosDepois: 2 },
          { alvo: "atendente", nota: 6, comentario: "resolveu mas demorou demais", minutosDepois: 41 },
        ]
      : [{ alvo: "ia", nota: 2, comentario: "de novo esse problema, cansei", minutosDepois: 2 }],
  };
}

// Ricardo também liga várias vezes na semana (menos que Fernanda) — mostra
// que a fila ordena por quantidade de chamados, não só por ter prioridade.
function sessaoSuporteRicardo(diasAtras: number, resolvida: boolean, numeroChamada: number): SessaoSeed {
  const reclamacao =
    numeroChamada === 1
      ? "minha internet cai toda hora, ja e a terceira vez que isso acontece"
      : `internet caiu de novo, essa e a ${numeroChamada}a vez que eu ligo essa semana`;
  const mensagens: MensagemSeed[] = [
    {
      remetente: "cliente",
      conteudo: reclamacao,
      minutosDepois: 0,
      categoria: "atendimento/suporte_tecnico",
      tom: "frustracao",
    },
    {
      remetente: "vox",
      conteudo:
        "Não consigo te ajudar com isso. Estou te transferindo para um atendente! Antes disso, de 0 a 10, o quanto você recomendaria o atendimento do assistente virtual?",
      minutosDepois: 1,
    },
  ];
  if (resolvida) {
    mensagens.push(
      { remetente: "atendente", conteudo: "Oi Ricardo, vou verificar a estabilidade do sinal na sua região agora.", minutosDepois: 15 },
      {
        remetente: "atendente",
        conteudo: "Confirmei uma instabilidade pontual na sua região, já foi escalada para o time de infraestrutura.",
        minutosDepois: 25,
      }
    );
  }
  return {
    canal: "whatsapp",
    diasAtras,
    estado: resolvida ? "ENCERRADA" : "TRANSBORDO_PENDENTE",
    jornadaStatus: resolvida ? "RESOLVIDO" : "AGUARDANDO_TRANSBORDO",
    mensagens,
    briefing: {
      motivo_transbordo: "cliente demonstrou frustração na mensagem",
      tom_emocional: "frustracao",
      resumo_jornada: `Cliente Ricardo Teixeira, intenção: atendimento/suporte_tecnico. Última mensagem: "${reclamacao}".`,
      sugestao_resolucao: "Verificar instabilidade confirmada na região antes de agendar visita técnica.",
      atendenteId: resolvida ? ATENDENTE_DEMO_NOME : null,
      assumidoMinutosDepois: resolvida ? 12 : undefined,
      encerradoMinutosDepois: resolvida ? 27 : undefined,
    },
    nps: resolvida ? [{ alvo: "atendente", nota: 7, comentario: "resolveram, mas eh a terceira vez esse mes", minutosDepois: 28 }] : undefined,
  };
}

const CLIENTES_DEMO: ClienteSeed[] = [
  {
    nome: "Fernanda Alves",
    tipoCliente: "ativo",
    cpf: "22233344405",
    sessoes: [
      sessaoCobrancaFernanda(6, true, 1),
      sessaoCobrancaFernanda(5, true, 2),
      sessaoCobrancaFernanda(3, true, 3),
      sessaoCobrancaFernanda(2, true, 4),
      sessaoCobrancaFernanda(0, false, 5),
    ],
  },
  {
    nome: "Ricardo Teixeira",
    tipoCliente: "ativo",
    cpf: "33344455512",
    sessoes: [sessaoSuporteRicardo(4, true, 1), sessaoSuporteRicardo(2, true, 2), sessaoSuporteRicardo(0, false, 3)],
  },
  {
    nome: "Roberto Nunes",
    tipoCliente: "ativo",
    cpf: "44455566623",
    sessoes: [
      {
        canal: "voz",
        diasAtras: 1,
        estado: "TRANSBORDO_PENDENTE",
        jornadaStatus: "AGUARDANDO_TRANSBORDO",
        mensagens: [
          {
            remetente: "cliente",
            conteudo: "preciso resolver isso com urgencia, minha internet caiu e eu trabalho de casa hoje",
            minutosDepois: 0,
            categoria: "atendimento/suporte_tecnico",
            tom: "urgencia",
          },
          {
            remetente: "vox",
            conteudo:
              "Sinto muito pelo transtorno. Para problemas de internet, o sistema verifica primeiro se há instabilidade confirmada na região do cliente; se não houver, orienta reiniciar o roteador e testar novamente antes de acionar uma visita técnica.",
            minutosDepois: 1,
          },
          {
            remetente: "cliente",
            conteudo: "ja reiniciei o roteador e continua sem internet, preciso disso resolvido agora mesmo",
            minutosDepois: 5,
            categoria: "atendimento/suporte_tecnico",
            tom: "urgencia",
          },
          {
            remetente: "vox",
            conteudo:
              "Não consigo te ajudar com isso. Estou te transferindo para um atendente! Antes disso, de 0 a 10, o quanto você recomendaria o atendimento do assistente virtual?",
            minutosDepois: 6,
          },
          {
            remetente: "cliente",
            conteudo: "por favor, isso e urgente, preciso de uma resposta o mais rapido possivel",
            minutosDepois: 7,
            categoria: "atendimento/suporte_tecnico",
            tom: "urgencia",
          },
        ],
        briefing: {
          motivo_transbordo: "cliente com urgência declarada e falha técnica não resolvida automaticamente",
          tom_emocional: "urgencia",
          resumo_jornada:
            'Cliente Roberto Nunes, intenção: atendimento/suporte_tecnico. Última mensagem: "ja reiniciei o roteador e continua sem internet, preciso disso resolvido agora mesmo".',
          sugestao_resolucao: "Confirmar se há instabilidade na região antes de agendar visita técnica; cliente está em home office.",
        },
        nps: [{ alvo: "ia", nota: 4, comentario: "nao resolveu e eu preciso disso rapido", minutosDepois: 7 }],
      },
    ],
  },
  {
    nome: "Juliana Prado",
    tipoCliente: "ativo",
    cpf: "55566677734",
    sessoes: [
      {
        canal: "app",
        diasAtras: 1,
        estado: "ATIVA",
        jornadaStatus: "EM_ANDAMENTO",
        mensagens: [
          {
            remetente: "cliente",
            conteudo: "queria saber quando vence minha fatura",
            minutosDepois: 0,
            categoria: "atendimento/consulta_fatura",
            tom: "neutro",
          },
          {
            remetente: "vox",
            conteudo:
              "A consulta de fatura mostra o valor total, a data de vencimento e o detalhamento por serviço. Quer que eu detalhe algum item específico?",
            minutosDepois: 1,
          },
          {
            remetente: "cliente",
            conteudo: "so isso mesmo, muito obrigada pela ajuda, foi super rapido",
            minutosDepois: 3,
            categoria: "atendimento/consulta_fatura",
            tom: "satisfacao",
          },
        ],
        nps: [{ alvo: "ia", nota: 10, comentario: "resolveu na hora, nem precisei de atendente", minutosDepois: 4 }],
      },
    ],
  },
  {
    nome: "Marcos Vieira",
    tipoCliente: "prospeccao",
    telefone: "11976543210",
    sessoes: [
      {
        canal: "site",
        diasAtras: 0,
        estado: "ATIVA",
        jornadaStatus: "EM_ANDAMENTO",
        mensagens: [
          {
            remetente: "cliente",
            conteudo: "quero saber quais planos voces tem com bastante internet",
            minutosDepois: 0,
            categoria: "venda/consulta_portfolio",
            tom: "neutro",
          },
          {
            remetente: "vox",
            conteudo:
              "Sobre isso: Plano Pós Ilimitado 120GB Premium: 120GB de internet de alta velocidade, ligações e SMS ilimitados, dois aplicativos de streaming de vídeo incluídos. Quer que eu detalhe outro plano ou já seguimos com esse?",
            minutosDepois: 1,
          },
        ],
      },
    ],
  },
  {
    nome: "Beatriz Lima",
    tipoCliente: "ativo",
    cpf: "77788899956",
    sessoes: [
      {
        canal: "whatsapp",
        diasAtras: 0,
        estado: "EM_ATENDIMENTO_HUMANO",
        jornadaStatus: "EM_ANDAMENTO",
        mensagens: [
          {
            remetente: "cliente",
            conteudo: "quero cancelar meu plano, mudei de cidade e nao vou usar mais",
            minutosDepois: 0,
            categoria: "venda/cancelamento",
            tom: "neutro",
          },
          {
            remetente: "vox",
            conteudo:
              "Antes de seguir com o cancelamento, queria entender o que está acontecendo. Às vezes consigo resolver o motivo sem precisar cancelar. Pode me contar o que houve?",
            minutosDepois: 1,
          },
          {
            remetente: "cliente",
            conteudo: "prefiro falar com uma pessoa mesmo, e um caso mais especifico",
            minutosDepois: 3,
            categoria: "atendimento/atendente_humano",
            tom: "neutro",
          },
          {
            remetente: "vox",
            conteudo: "Claro, já vou te conectar com um atendente humano com todo o histórico da nossa conversa.",
            minutosDepois: 4,
          },
          {
            remetente: "atendente",
            conteudo: "Oi Beatriz, tudo bem? Vi que você quer cancelar por mudança de cidade, posso verificar se dá pra transferir o endereço em vez de cancelar.",
            minutosDepois: 10,
          },
        ],
        briefing: {
          motivo_transbordo: "cliente solicitou atendente humano",
          tom_emocional: "neutro",
          resumo_jornada: 'Cliente Beatriz Lima, intenção: venda/cancelamento. Última mensagem: "prefiro falar com uma pessoa mesmo, e um caso mais especifico".',
          sugestao_resolucao: "Verificar se a mudança de cidade está dentro da área de cobertura antes de processar o cancelamento.",
          atendenteId: ATENDENTE_DEMO_NOME,
          assumidoMinutosDepois: 9,
        },
      },
    ],
  },
  {
    nome: "Patrícia Nogueira",
    tipoCliente: "ativo",
    cpf: "66677788845",
    acessibilidade: { modalidade_libras: true, leitor_de_tela: true },
    sessoes: [
      {
        canal: "app",
        diasAtras: 2,
        estado: "ENCERRADA",
        jornadaStatus: "RESOLVIDO",
        mensagens: [
          {
            remetente: "cliente",
            conteudo: "preciso reagendar a visita tecnica de instalacao",
            minutosDepois: 0,
            categoria: "atendimento/reagendar_visita",
            tom: "neutro",
          },
          {
            remetente: "vox",
            conteudo:
              "Visitas técnicas já agendadas podem ser reagendadas informando uma nova data e horário. Qual data e período funcionam melhor pra você?",
            minutosDepois: 1,
          },
          {
            remetente: "cliente",
            conteudo: "prefiro falar com atendente pra confirmar direitinho o horario",
            minutosDepois: 2,
            categoria: "atendimento/atendente_humano",
            tom: "neutro",
          },
          { remetente: "atendente", conteudo: "Oi Patrícia, reagendei sua visita para quinta de manhã, das 8h às 12h.", minutosDepois: 15 },
        ],
        briefing: {
          motivo_transbordo: "cliente solicitou atendente humano",
          tom_emocional: "neutro",
          resumo_jornada: 'Cliente Patrícia Nogueira, intenção: atendimento/reagendar_visita. Última mensagem: "prefiro falar com atendente pra confirmar direitinho o horario".',
          sugestao_resolucao: "Confirmar janela de horário compatível com a preferência de atendimento em Libras.",
          atendenteId: ATENDENTE_DEMO_NOME,
          assumidoMinutosDepois: 10,
          encerradoMinutosDepois: 16,
        },
        nps: [
          { alvo: "ia", nota: 8, comentario: "entendeu bem o que eu precisava", minutosDepois: 3 },
          { alvo: "atendente", nota: 9, comentario: "atendente foi bem atencioso", minutosDepois: 17 },
        ],
      },
    ],
  },
];

async function clienteJaExiste(cenario: ClienteSeed): Promise<boolean> {
  if (cenario.cpf) {
    const r = await pool.query("SELECT id FROM cliente WHERE cpf_hash = $1", [hashCpf(cenario.cpf)]);
    return r.rows.length > 0;
  }
  const r = await pool.query("SELECT id FROM cliente WHERE nome = $1 AND tipo_cliente = 'prospeccao'", [cenario.nome]);
  return r.rows.length > 0;
}

function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * 86400000);
}

function maisMinutos(base: Date, minutos: number): Date {
  return new Date(base.getTime() + minutos * 60000);
}

async function criarClienteCenario(cenario: ClienteSeed, canalIdPorNome: Map<string, string>) {
  if (await clienteJaExiste(cenario)) {
    console.log(`[seed] cliente de demonstração '${cenario.nome}' já existe, pulando`);
    return;
  }

  const diasMaisAntigo = Math.max(0, ...cenario.sessoes.map((s) => s.diasAtras)) + 3;
  const clienteRes = await pool.query(
    `INSERT INTO cliente (cpf_hash, telefone, nome, tipo_cliente, consentimento_ts, consentimento_versao, data_cadastro)
     VALUES ($1, $2, $3, $4, $5, 'v1', $5) RETURNING id`,
    [cenario.cpf ? hashCpf(cenario.cpf) : null, cenario.telefone || null, cenario.nome, cenario.tipoCliente, diasAtras(diasMaisAntigo)]
  );
  const clienteId = clienteRes.rows[0].id;

  await pool.query(
    `INSERT INTO preferencia_acessibilidade (cliente_id, modalidade_libras, leitor_de_tela, linguagem_simplificada)
     VALUES ($1, $2, $3, $4)`,
    [
      clienteId,
      !!cenario.acessibilidade?.modalidade_libras,
      !!cenario.acessibilidade?.leitor_de_tela,
      !!cenario.acessibilidade?.linguagem_simplificada,
    ]
  );

  for (const sessao of cenario.sessoes) {
    const canalId = canalIdPorNome.get(sessao.canal)!;
    const criadoEm = diasAtras(sessao.diasAtras);
    const ultimaMensagem = sessao.mensagens[sessao.mensagens.length - 1];
    const atualizadoEm = maisMinutos(criadoEm, ultimaMensagem?.minutosDepois || 0);

    const sessaoRes = await pool.query(
      `INSERT INTO sessao (cliente_id, canal_origem_id, estado, criado_em, atualizado_em) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [clienteId, canalId, sessao.estado, criadoEm, atualizadoEm]
    );
    const sessaoId = sessaoRes.rows[0].id;

    const ultimaIntencaoCliente = [...sessao.mensagens].reverse().find((m) => m.remetente === "cliente" && m.categoria);
    await pool.query(
      `INSERT INTO contexto (sessao_id, canal_atual, jornada_status, ultima_intencao, atualizado_em) VALUES ($1, $2, $3, $4, $5)`,
      [
        sessaoId,
        sessao.canal,
        sessao.jornadaStatus,
        ultimaIntencaoCliente
          ? JSON.stringify({ categoria: ultimaIntencaoCliente.categoria, tom_emocional: ultimaIntencaoCliente.tom })
          : null,
        atualizadoEm,
      ]
    );

    for (const m of sessao.mensagens) {
      const ts = maisMinutos(criadoEm, m.minutosDepois);
      const msgRes = await pool.query(
        `INSERT INTO mensagem (sessao_id, canal_id, remetente, conteudo, timestamp) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [sessaoId, canalId, m.remetente, m.conteudo, ts]
      );
      if (m.remetente === "cliente" && m.categoria) {
        await pool.query(
          `INSERT INTO intencao (mensagem_id, categoria, subcategoria, confianca, tom_emocional) VALUES ($1, $2, NULL, 0.85, $3)`,
          [msgRes.rows[0].id, m.categoria, m.tom || null]
        );
      }
    }

    let briefingId: string | null = null;
    if (sessao.briefing) {
      const b = sessao.briefing;
      const geradoEm = maisMinutos(criadoEm, ultimaMensagem?.minutosDepois || 1);
      const briefingRes = await pool.query(
        `INSERT INTO briefing (sessao_id, resumo_jornada, canais_utilizados, tom_emocional, motivo_transbordo, sugestao_resolucao, gerado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [sessaoId, b.resumo_jornada, sessao.canal, b.tom_emocional, b.motivo_transbordo, b.sugestao_resolucao, geradoEm]
      );
      briefingId = briefingRes.rows[0].id;
      await pool.query(
        `INSERT INTO handoff (briefing_id, atendente_id, canal_origem, assumido_em, encerrado_em) VALUES ($1, $2, $3, $4, $5)`,
        [
          briefingId,
          b.atendenteId || null,
          sessao.canal,
          b.assumidoMinutosDepois !== undefined ? maisMinutos(criadoEm, b.assumidoMinutosDepois) : null,
          b.encerradoMinutosDepois !== undefined ? maisMinutos(criadoEm, b.encerradoMinutosDepois) : null,
        ]
      );
    }

    if (sessao.nps) {
      for (const n of sessao.nps) {
        await pool.query(
          `INSERT INTO nps (sessao_id, alvo, nota, comentario, briefing_id, atendente_id, criado_em) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            sessaoId,
            n.alvo,
            n.nota,
            n.comentario || null,
            n.alvo === "atendente" ? briefingId : null,
            n.alvo === "atendente" ? sessao.briefing?.atendenteId || null : null,
            maisMinutos(criadoEm, n.minutosDepois),
          ]
        );
      }
    }
  }

  console.log(`[seed] cliente de demonstração '${cenario.nome}' criado com ${cenario.sessoes.length} sessão(ões)`);
}

// Entradas de auditoria de exemplo, para a seção "Auditoria" da Visão geral
// já aparecer preenchida sem precisar clicar em nada antes. Inserido direto
// (sem passar pelo helper `audit()`, que só grava com timestamp = agora) para
// as datas ficarem espalhadas nos últimos dias, como um histórico real.
async function seedAuditoria() {
  const existente = await pool.query("SELECT COUNT(*) FROM auditoria");
  if (Number(existente.rows[0].count) > 0) {
    console.log("[seed] auditoria já tem registros, pulando");
    return;
  }
  const entradas: { ator: string; acao: string; diasAtras: number; minutosAtras?: number }[] = [
    { ator: "admin@clarovox.com", acao: "auth.login", diasAtras: 6 },
    { ator: "atendente@clarovox.com", acao: "auth.login", diasAtras: 6 },
    { ator: "atendente@clarovox.com", acao: "handoff.assumido", diasAtras: 5 },
    { ator: "atendente@clarovox.com", acao: "auth.login", diasAtras: 3 },
    { ator: "civ", acao: "clientes.detalhe.read", diasAtras: 3 },
    { ator: "atendente@clarovox.com", acao: "handoff.assumido", diasAtras: 2 },
    { ator: "civ", acao: "sessions.transcript.export", diasAtras: 2 },
    { ator: "admin@clarovox.com", acao: "auth.login", diasAtras: 1 },
    { ator: "admin@clarovox.com", acao: "usuarios.atualizado", diasAtras: 1 },
    { ator: "atendente@clarovox.com", acao: "auth.login", diasAtras: 0 },
    { ator: "atendente@clarovox.com", acao: "handoff.assumido", diasAtras: 0, minutosAtras: 30 },
  ];
  for (const e of entradas) {
    const timestamp = new Date(Date.now() - e.diasAtras * 86400000 - (e.minutosAtras || 0) * 60000);
    await pool.query(`INSERT INTO auditoria (ator, acao, timestamp) VALUES ($1, $2, $3)`, [e.ator, e.acao, timestamp]);
  }
  console.log(`[seed] ${entradas.length} entrada(s) de auditoria de exemplo criadas`);
}

async function main() {
  console.log("[seed] iniciando...");

  for (const c of CANAIS) {
    await pool.query(
      `INSERT INTO canal (nome, tipo_adapter) VALUES ($1, $2) ON CONFLICT (nome) DO NOTHING`,
      [c.nome, c.tipo_adapter]
    );
  }
  const canalIdPorNome = new Map<string, string>();
  const canaisRows = await pool.query("SELECT id, nome FROM canal");
  canaisRows.rows.forEach((r) => canalIdPorNome.set(r.nome, r.id));
  console.log(`[seed] ${CANAIS.length} canais garantidos`);

  // Insere item por item (checando pelo título) em vez de só popular quando
  // a tabela está vazia — assim rodar o seed de novo depois de expandir
  // KNOWLEDGE_BASE adiciona só o que é novo, sem duplicar nem apagar o que
  // já está no banco.
  const existingKb = await pool.query("SELECT titulo FROM knowledge_base");
  const titulosExistentes = new Set(existingKb.rows.map((r) => r.titulo));
  let novosItens = 0;
  for (const item of KNOWLEDGE_BASE) {
    if (titulosExistentes.has(item.titulo)) continue;
    const vec = embed(`${item.titulo} ${item.conteudo}`);
    await pool.query(
      `INSERT INTO knowledge_base (titulo, conteudo, categoria, embedding) VALUES ($1, $2, $3, $4)`,
      [item.titulo, item.conteudo, item.categoria, `[${vec.join(",")}]`]
    );
    novosItens++;
  }
  console.log(`[seed] ${novosItens} novo(s) item(ns) adicionados (${KNOWLEDGE_BASE.length} no total do catálogo)`);

  // Cliente de demonstração (Carlos, dos cenários da documentação técnica),
  // já com uma fatura fictícia registrada via metadado no histórico.
  const existingCliente = await pool.query("SELECT id FROM cliente WHERE cpf_hash = $1", [hashCpf("11122233396")]);
  if (!existingCliente.rows.length) {
    await pool.query(
      `INSERT INTO cliente (cpf_hash, nome, tipo_cliente, consentimento_ts, consentimento_versao)
       VALUES ($1, 'Carlos', 'ativo', now(), 'v1')`,
      [hashCpf("11122233396")]
    );
    console.log("[seed] cliente de demonstração 'Carlos' criado (CPF de teste: 111.222.333-96)");
  } else {
    console.log("[seed] cliente de demonstração já existe");
  }

  // Clientes de demonstração com histórico completo (sessões, transbordos,
  // NPS) — populam a Visão geral, a fila de transbordo (com os alertas de
  // comportamento) e a aba Clientes de uma vez, sem precisar usar o app.
  for (const cenario of CLIENTES_DEMO) {
    await criarClienteCenario(cenario, canalIdPorNome);
  }

  await seedAuditoria();

  for (const u of USUARIOS_DEMO) {
    const existente = await pool.query("SELECT id FROM usuario WHERE email = $1", [u.email]);
    if (existente.rows.length) {
      console.log(`[seed] usuário de demonstração '${u.email}' já existe`);
      continue;
    }
    const senhaHash = await hashSenha(u.senha);
    const mfaSecret = gerarSegredoMfa();
    await pool.query(
      `INSERT INTO usuario (nome, email, senha_hash, role, mfa_secret) VALUES ($1, $2, $3, $4, $5)`,
      [u.nome, u.email, senhaHash, u.role, mfaSecret]
    );
    console.log(`[seed] usuário de demonstração '${u.email}' (${u.role}) criado — senha: ${u.senha}`);
  }
  console.log(
    "[seed] no primeiro login de cada usuário de demonstração, o painel mostra o QR code para configurar o MFA (Google Authenticator, Authy, etc.)."
  );

  console.log("[seed] concluído.");
  await pool.end();
}

main().catch((e) => {
  console.error("[seed] erro:", e);
  process.exit(1);
});
