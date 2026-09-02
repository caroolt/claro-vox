import "dotenv/config";
import { pool } from "./db";
import { embed } from "./embedding";
import { hashCpf } from "./crypto";

// Dados fictícios de demonstração — planos ilustrativos para o MVP acadêmico,
// não refletem o portfólio comercial real da Claro.
const KNOWLEDGE_BASE = [
  {
    titulo: "Plano Controle 15GB",
    categoria: "plano",
    conteudo: "Plano Controle 15GB: 15GB de internet, ligações ilimitadas para qualquer operadora, WhatsApp ilimitado sem consumir franquia. Ideal para quem usa o celular no dia a dia sem grande consumo de vídeo.",
  },
  {
    titulo: "Plano Pós Ilimitado 60GB",
    categoria: "plano",
    conteudo: "Plano Pós Ilimitado 60GB: 60GB de internet de alta velocidade, ligações e SMS ilimitados, inclui acesso a aplicativos de streaming em parceria. Indicado para quem consome bastante vídeo e redes sociais.",
  },
  {
    titulo: "Plano Família Compartilhado 100GB",
    categoria: "plano",
    conteudo: "Plano Família Compartilhado 100GB: franquia de 100GB dividida entre até 4 linhas, ligações ilimitadas entre as linhas do grupo, cada linha adicional com desconto progressivo.",
  },
  {
    titulo: "Como funciona o Cold Start",
    categoria: "faq",
    conteudo: "O Claro Vox identifica o cliente na primeira interação perguntando se já é cliente, o nome e o CPF ou telefone, e depois mantém esse reconhecimento em qualquer canal (WhatsApp, Site, App) sem precisar repetir os dados.",
  },
  {
    titulo: "Política de cobrança contestada",
    categoria: "faq",
    conteudo: "Cobranças contestadas são verificadas automaticamente contra o histórico de faturas; quando a verificação automática não resolve, o atendimento é transferido a um atendente humano com o resumo completo da jornada.",
  },
  {
    titulo: "Diagnóstico de sem internet",
    categoria: "suporte_tecnico",
    conteudo: "Para problemas de internet, o sistema verifica primeiro se há instabilidade confirmada na região do cliente; se não houver, orienta reiniciar o roteador e testar novamente antes de acionar uma visita técnica.",
  },
  {
    titulo: "Reagendamento de visita técnica",
    categoria: "suporte_tecnico",
    conteudo: "Visitas técnicas já agendadas podem ser reagendadas informando uma nova data e horário; a nova visita é confirmada e a anterior liberada automaticamente na agenda do time de campo.",
  },
];

const CANAIS = [
  { nome: "whatsapp", tipo_adapter: "whatsapp-business-api" },
  { nome: "site", tipo_adapter: "web" },
  { nome: "app", tipo_adapter: "mobile" },
];

async function main() {
  console.log("[seed] iniciando...");

  for (const c of CANAIS) {
    await pool.query(
      `INSERT INTO canal (nome, tipo_adapter) VALUES ($1, $2) ON CONFLICT (nome) DO NOTHING`,
      [c.nome, c.tipo_adapter]
    );
  }
  console.log(`[seed] ${CANAIS.length} canais garantidos`);

  const existingKb = await pool.query("SELECT COUNT(*) FROM knowledge_base");
  if (Number(existingKb.rows[0].count) === 0) {
    for (const item of KNOWLEDGE_BASE) {
      const vec = embed(`${item.titulo} ${item.conteudo}`);
      await pool.query(
        `INSERT INTO knowledge_base (titulo, conteudo, categoria, embedding) VALUES ($1, $2, $3, $4)`,
        [item.titulo, item.conteudo, item.categoria, `[${vec.join(",")}]`]
      );
    }
    console.log(`[seed] ${KNOWLEDGE_BASE.length} itens na base de conhecimento`);
  } else {
    console.log("[seed] base de conhecimento já populada, pulando");
  }

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

  console.log("[seed] concluído.");
  await pool.end();
}

main().catch((e) => {
  console.error("[seed] erro:", e);
  process.exit(1);
});
