import { Router } from "express";
import { pool, audit } from "../db";
import { hashCpf, maskCpf } from "../crypto";
import { getOrCreateCanal } from "../helpers";
import { cacheSessionContext } from "../redisClient";
import { broadcast } from "../ws";
import { h } from "../asyncHandler";

export const coldstartRouter = Router();

// Rascunhos em memória do fluxo de Cold Start em andamento (RF010).
// Não precisa ser durável: se o processo reiniciar no meio do fluxo,
// o cliente simplesmente recomeça — o estado definitivo só é gravado
// no Postgres quando o Cold Start é concluído.
type Draft = { canal: string; canalConversaId: string; jaCliente?: boolean; nome?: string; etapa: string };
const drafts = new Map<string, Draft>();

// -------- 1) Início do Cold Start (cliente novo, sem sessão) --------
coldstartRouter.post("/start", h(async (req, res) => {
  const { canal, canal_conversa_id, mensagem_inicial } = req.body || {};
  if (!canal || !canal_conversa_id) {
    return res.status(400).json({ erro: "canal e canal_conversa_id são obrigatórios" });
  }
  const canalId = await getOrCreateCanal(canal);
  const sessao = await pool.query(
    `INSERT INTO sessao (canal_origem_id, estado, cold_start_etapa) VALUES ($1, 'COLD_START', 'pergunta_cliente') RETURNING id, estado`,
    [canalId]
  );
  const sessaoId = sessao.rows[0].id;
  drafts.set(sessaoId, { canal, canalConversaId: canal_conversa_id, etapa: "pergunta_cliente" });

  if (mensagem_inicial) {
    await pool.query(
      `INSERT INTO mensagem (sessao_id, canal_id, remetente, conteudo) VALUES ($1, $2, 'cliente', $3)`,
      [sessaoId, canalId, mensagem_inicial]
    );
  }
  const resposta = "Olá! Seja bem-vindo à Claro. Você já é nosso cliente?";
  await pool.query(`INSERT INTO mensagem (sessao_id, canal_id, remetente, conteudo) VALUES ($1, $2, 'vox', $3)`, [sessaoId, canalId, resposta]);
  await audit("civ", "coldstart.start", sessaoId);
  broadcast("session.updated", { sessao_id: sessaoId, estado: "COLD_START" });

  res.status(201).json({ sessao_id: sessaoId, estado: "COLD_START", proxima_pergunta: resposta });
}));

// -------- 2) Respostas do Cold Start, uma pergunta por vez --------
coldstartRouter.post("/answer", h(async (req, res) => {
  const { sessao_id, resposta } = req.body || {};
  const draft = drafts.get(sessao_id);
  if (!draft) return res.status(404).json({ erro: "sessão de Cold Start não encontrada ou já concluída" });

  const canalId = await getOrCreateCanal(draft.canal);
  await pool.query(`INSERT INTO mensagem (sessao_id, canal_id, remetente, conteudo) VALUES ($1, $2, 'cliente', $3)`, [sessao_id, canalId, String(resposta)]);

  if (draft.etapa === "pergunta_cliente") {
    draft.jaCliente = /sim|já sou|sou cliente|yes/i.test(String(resposta));
    draft.etapa = "pergunta_nome";
    await pool.query(`UPDATE sessao SET cold_start_etapa = $1, atualizado_em = now() WHERE id = $2`, [draft.etapa, sessao_id]);
    const pergunta = "Ótimo! Como prefere ser chamado?";
    await pool.query(`INSERT INTO mensagem (sessao_id, canal_id, remetente, conteudo) VALUES ($1, $2, 'vox', $3)`, [sessao_id, canalId, pergunta]);
    return res.json({ sessao_id, estado: "COLD_START", proxima_pergunta: pergunta });
  }

  if (draft.etapa === "pergunta_nome") {
    draft.nome = String(resposta).trim();
    draft.etapa = "pergunta_identificador";
    await pool.query(`UPDATE sessao SET cold_start_etapa = $1, atualizado_em = now() WHERE id = $2`, [draft.etapa, sessao_id]);
    const pergunta = draft.jaCliente
      ? `${draft.nome}, pode me informar seu CPF para eu te identificar?`
      : `${draft.nome}, pode me informar seu telefone para eu criar seu cadastro?`;
    await pool.query(`INSERT INTO mensagem (sessao_id, canal_id, remetente, conteudo) VALUES ($1, $2, 'vox', $3)`, [sessao_id, canalId, pergunta]);
    return res.json({ sessao_id, estado: "COLD_START", proxima_pergunta: pergunta });
  }

  if (draft.etapa === "pergunta_identificador") {
    const identificador = String(resposta).replace(/\D/g, "");
    const tipoCliente = draft.jaCliente ? "ativo" : "prospeccao";
    const cpfHash = draft.jaCliente ? hashCpf(identificador) : null;
    const telefone = draft.jaCliente ? null : identificador;

    // Se o CPF já pertence a um cliente cadastrado (ex.: retomando contato
    // depois de um tempo), reconhece a conta existente em vez de duplicar.
    let clienteId: string;
    let nomeFinal = draft.nome!;
    let clienteReconhecido = false;
    if (cpfHash) {
      const existente = await pool.query("SELECT id, nome FROM cliente WHERE cpf_hash = $1", [cpfHash]);
      if (existente.rows.length) {
        clienteId = existente.rows[0].id;
        nomeFinal = existente.rows[0].nome;
        clienteReconhecido = true;
      } else {
        const criado = await pool.query(
          `INSERT INTO cliente (cpf_hash, telefone, nome, tipo_cliente, consentimento_ts, consentimento_versao)
           VALUES ($1, $2, $3, $4, now(), 'v1') RETURNING id`,
          [cpfHash, telefone, draft.nome, tipoCliente]
        );
        clienteId = criado.rows[0].id;
        await pool.query(`INSERT INTO preferencia_acessibilidade (cliente_id) VALUES ($1)`, [clienteId]);
      }
    } else {
      const criado = await pool.query(
        `INSERT INTO cliente (cpf_hash, telefone, nome, tipo_cliente, consentimento_ts, consentimento_versao)
         VALUES ($1, $2, $3, $4, now(), 'v1') RETURNING id`,
        [cpfHash, telefone, draft.nome, tipoCliente]
      );
      clienteId = criado.rows[0].id;
      await pool.query(`INSERT INTO preferencia_acessibilidade (cliente_id) VALUES ($1)`, [clienteId]);
    }
    draft.nome = nomeFinal;
    await pool.query(`UPDATE sessao SET cliente_id = $1, estado = 'ATIVA', cold_start_etapa = NULL, atualizado_em = now() WHERE id = $2`, [clienteId, sessao_id]);
    const contextoRes = await pool.query(
      `INSERT INTO contexto (sessao_id, canal_atual, jornada_status) VALUES ($1, $2, 'EM_ANDAMENTO') RETURNING *`,
      [sessao_id, draft.canal]
    );
    await cacheSessionContext(sessao_id, contextoRes.rows[0]);

    // A mensagem de boas-vindas reflete o que de fato aconteceu no
    // cadastro (RF011): reconhecimento de conta existente, primeiro
    // cadastro como cliente ativo, ou cadastro na base de prospecção —
    // "encontrei sua conta" só faz sentido no primeiro caso.
    const boasVindas = clienteReconhecido
      ? `Encontrei sua conta, ${draft.nome}. Como posso te ajudar hoje?`
      : draft.jaCliente
        ? `Prazer, ${draft.nome}! Vou guardar seus dados para os próximos contatos. Como posso te ajudar hoje?`
        : `Cadastro criado, ${draft.nome}! Como posso te ajudar hoje?`;
    await pool.query(`INSERT INTO mensagem (sessao_id, canal_id, remetente, conteudo) VALUES ($1, $2, 'vox', $3)`, [sessao_id, canalId, boasVindas]);
    drafts.delete(sessao_id);
    await audit("civ", "coldstart.completo", sessao_id);
    broadcast("session.updated", { sessao_id, estado: "ATIVA", cliente_id: clienteId });

    return res.json({
      sessao_id,
      estado: "ATIVA",
      mensagem: boasVindas,
      cliente: { id: clienteId, nome: draft.nome, tipo_cliente: tipoCliente, cpf_mascarado: draft.jaCliente ? maskCpf(identificador) : null },
    });
  }

  res.status(400).json({ erro: "etapa de Cold Start desconhecida" });
}));

// -------- 3) Reconhecimento automático ao trocar de canal (RF004) --------
coldstartRouter.post("/reconhecer", h(async (req, res) => {
  const { canal, cpf } = req.body || {};
  if (!canal || !cpf) return res.status(400).json({ erro: "canal e cpf são obrigatórios" });

  const cpfHash = hashCpf(cpf);
  const clienteRes = await pool.query("SELECT * FROM cliente WHERE cpf_hash = $1", [cpfHash]);
  if (!clienteRes.rows.length) {
    return res.status(404).json({ reconhecido: false, motivo: "cliente não encontrado — iniciar Cold Start normal" });
  }
  const cliente = clienteRes.rows[0];

  const anterior = await pool.query(
    `SELECT s.*, c.canal_atual, c.ultima_intencao, c.historico_resumido
     FROM sessao s LEFT JOIN contexto c ON c.sessao_id = s.id
     WHERE s.cliente_id = $1 AND s.estado != 'ENCERRADA'
     ORDER BY s.atualizado_em DESC LIMIT 1`,
    [cliente.id]
  );
  const canalAnterior = anterior.rows[0]?.canal_atual || null;
  const ultimaIntencao = anterior.rows[0]?.ultima_intencao || null;
  const historico = anterior.rows[0]?.historico_resumido || null;

  const canalId = await getOrCreateCanal(canal);
  const novaSessao = await pool.query(
    `INSERT INTO sessao (cliente_id, canal_origem_id, estado) VALUES ($1, $2, 'ATIVA') RETURNING id`,
    [cliente.id, canalId]
  );
  const sessaoId = novaSessao.rows[0].id;
  const contextoRes = await pool.query(
    `INSERT INTO contexto (sessao_id, canal_atual, canal_anterior, ultima_intencao, historico_resumido, jornada_status)
     VALUES ($1, $2, $3, $4, $5, 'EM_ANDAMENTO') RETURNING *`,
    [sessaoId, canal, canalAnterior, ultimaIntencao, historico]
  );
  await cacheSessionContext(sessaoId, contextoRes.rows[0]);

  const mensagem = canalAnterior && canalAnterior !== canal
    ? `Olá de novo, ${cliente.nome}! Quer continuar de onde paramos ou tem algo novo?`
    : `Olá, ${cliente.nome}! Como posso ajudar?`;
  await pool.query(`INSERT INTO mensagem (sessao_id, canal_id, remetente, conteudo) VALUES ($1, $2, 'vox', $3)`, [sessaoId, canalId, mensagem]);
  await audit("civ", "coldstart.reconhecido", sessaoId);
  broadcast("session.updated", { sessao_id: sessaoId, estado: "ATIVA", cliente_id: cliente.id, handoff_canal: true });

  res.json({
    reconhecido: true,
    sessao_id: sessaoId,
    estado: "ATIVA",
    mensagem,
    cliente: { id: cliente.id, nome: cliente.nome, tipo_cliente: cliente.tipo_cliente },
    contexto: contextoRes.rows[0],
    canal_anterior: canalAnterior,
  });
}));
