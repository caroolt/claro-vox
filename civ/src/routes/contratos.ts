import { Router } from "express";
import { pool, audit } from "../db";
import { hashCpf } from "../crypto";
import { h } from "../asyncHandler";

export const contratosRouter = Router();

const TIPOS_PLANO = ["pre-pago", "controle", "pos-pago"];

function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Confere se o nome digitado bate com o nome em cadastro — exige que ao
// menos o primeiro nome coincida (tolera sobrenome digitado diferente,
// mas não deixa passar uma pessoa diferente).
function nomesConferem(digitado: string, cadastrado: string): boolean {
  const a = normalizarNome(digitado).split(/\s+/)[0] || "";
  const b = normalizarNome(cadastrado).split(/\s+/)[0] || "";
  return !!a && a === b;
}

// POST /v1/contratos — finaliza a contratação simulada de um plano
// (pré-pago/controle/pós). Chamada internamente pelo Orquestrador ao fim do
// fluxo guiado de coleta de dados no chat (não é uma tela própria).
//
// Cliente já da base (cliente.cpf_hash preenchido): nome e CPF digitados
// precisam conferir com o cadastro — senão a contratação é recusada
// (simula a verificação de identidade de uma contratação real).
// Cliente novo/prospecção (sem CPF ainda): os dados digitados completam o
// cadastro e o promovem para cliente ativo (KYC simplificado do MVP).
contratosRouter.post("/", h(async (req, res) => {
  const { sessao_id, tipo_plano, nome, data_nascimento, cpf } = req.body || {};
  if (!sessao_id || !tipo_plano || !nome || !data_nascimento || !cpf) {
    return res.status(400).json({ erro: "sessao_id, tipo_plano, nome, data_nascimento e cpf são obrigatórios" });
  }
  if (!TIPOS_PLANO.includes(tipo_plano)) {
    return res.status(400).json({ erro: `tipo_plano deve ser um de: ${TIPOS_PLANO.join(", ")}` });
  }

  const sessaoRes = await pool.query("SELECT * FROM sessao WHERE id = $1", [sessao_id]);
  if (!sessaoRes.rows.length) return res.status(404).json({ erro: "sessão não encontrada" });
  const sessao = sessaoRes.rows[0];
  if (!sessao.cliente_id) return res.status(400).json({ erro: "sessão sem cliente identificado" });

  const clienteRes = await pool.query("SELECT * FROM cliente WHERE id = $1", [sessao.cliente_id]);
  const cliente = clienteRes.rows[0];
  const cpfLimpo = String(cpf).replace(/\D/g, "");
  if (cpfLimpo.length !== 11) return res.status(400).json({ erro: "cpf inválido" });
  const cpfHash = hashCpf(cpfLimpo);

  if (cliente.cpf_hash) {
    // Já é cliente da base — precisa confirmar identidade antes de contratar.
    if (cliente.cpf_hash !== cpfHash || !nomesConferem(nome, cliente.nome)) {
      await audit("orchestrator", "contrato.dados_divergentes", sessao_id);
      return res.status(409).json({ erro: "dados_nao_conferem", mensagem: "Nome ou CPF não conferem com o cadastro." });
    }
  } else {
    // Prospecção virando cliente ativo — CPF não pode já pertencer a outro cadastro.
    const outro = await pool.query("SELECT id FROM cliente WHERE cpf_hash = $1 AND id <> $2", [cpfHash, cliente.id]);
    if (outro.rows.length) {
      return res.status(409).json({ erro: "cpf_ja_cadastrado", mensagem: "Esse CPF já pertence a outro cadastro." });
    }
    await pool.query(
      `UPDATE cliente SET cpf_hash = $1, tipo_cliente = 'ativo', consentimento_ts = COALESCE(consentimento_ts, now()), consentimento_versao = COALESCE(consentimento_versao, 'v1') WHERE id = $2`,
      [cpfHash, cliente.id]
    );
  }

  await pool.query(`UPDATE cliente SET data_nascimento = $1 WHERE id = $2`, [data_nascimento, cliente.id]);

  // Reaproveita o protocolo da sessão (identifica a chamada) como
  // identificador da solicitação de contratação.
  const protocolo: string = sessao.protocolo || sessao_id;
  const contratoRes = await pool.query(
    `INSERT INTO contrato (cliente_id, sessao_id, tipo_plano, protocolo) VALUES ($1, $2, $3, $4) RETURNING *`,
    [cliente.id, sessao_id, tipo_plano, protocolo]
  );
  await audit("orchestrator", "contrato.confirmado", contratoRes.rows[0].id);

  // Regra A do motor de fraude (Seção "Camada de Fraude"): volume de linhas
  // pré-pagas confirmadas no mesmo CPF acima do limite configurável. Não
  // bloqueia a contratação (já confirmada acima) — gera um alerta de alta
  // confiança para investigação, com a evidência que embasa a decisão (XAI).
  if (tipo_plano === "pre-pago") {
    await checarRegraAVolumeCpf(cliente.id, cliente.nome);
  }

  res.status(201).json({
    contrato_id: contratoRes.rows[0].id,
    protocolo,
    tipo_plano,
    cliente: { id: cliente.id, nome: cliente.nome },
  });
}));

async function checarRegraAVolumeCpf(clienteId: string, clienteNome: string) {
  const [limiarRes, contagemRes] = await Promise.all([
    pool.query(`SELECT valor FROM configuracao WHERE chave = 'limiar_fraude_pre_pago'`),
    pool.query(
      `SELECT COUNT(*) AS total, array_agg(protocolo) AS protocolos FROM contrato
       WHERE cliente_id = $1 AND tipo_plano = 'pre-pago' AND status = 'confirmado'`,
      [clienteId]
    ),
  ]);
  const limiar = limiarRes.rows.length ? Number(limiarRes.rows[0].valor) : 3;
  const total = Number(contagemRes.rows[0]?.total || 0);
  if (total <= limiar) return;

  const explicacao = `${clienteNome} tem ${total} linhas pré-pagas confirmadas no próprio CPF, acima do limite configurado de ${limiar}.`;
  const evidencia = {
    cliente_nome: clienteNome,
    total_linhas_pre_pago: total,
    protocolos: contagemRes.rows[0].protocolos,
    limiar,
  };
  const existente = await pool.query(
    `SELECT id FROM alerta_fraude WHERE regra = 'A_volume_cpf' AND clientes_ids = $1::uuid[] AND status = 'aberto'`,
    [[clienteId]]
  );
  if (existente.rows.length) {
    await pool.query(`UPDATE alerta_fraude SET evidencia = $1, explicacao = $2, criado_em = now() WHERE id = $3`, [
      JSON.stringify(evidencia),
      explicacao,
      existente.rows[0].id,
    ]);
  } else {
    await pool.query(
      `INSERT INTO alerta_fraude (regra, clientes_ids, evidencia, explicacao, confianca) VALUES ('A_volume_cpf', $1::uuid[], $2, $3, 'alta')`,
      [[clienteId], JSON.stringify(evidencia), explicacao]
    );
  }
  await audit("civ", "fraude.alerta.gerado", clienteId);
}
