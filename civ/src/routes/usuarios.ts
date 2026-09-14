import { Router } from "express";
import { pool, audit } from "../db";
import { h } from "../asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { gerarSegredoMfa, hashSenha, Role } from "../auth";

export const usuariosRouter = Router();

// Toda a gestão de contas (aba "Atendentes" do painel, exclusiva da role
// admin — CRUD de atendentes/admins do Vox Briefing).
usuariosRouter.use(requireAuth, requireRole("admin"));

const CAMPOS_PUBLICOS = "id, nome, email, role, ativo, mfa_ativado, criado_em";

function validarRole(role: unknown): role is Role {
  return role === "admin" || role === "atendente";
}

// GET /v1/usuarios — lista todos os usuários (nunca devolve senha_hash/mfa_secret)
usuariosRouter.get("/", h(async (_req, res) => {
  const result = await pool.query(`SELECT ${CAMPOS_PUBLICOS} FROM usuario ORDER BY criado_em DESC`);
  res.json(result.rows);
}));

// POST /v1/usuarios — cria um novo atendente ou admin. MFA começa desativado
// — o próprio usuário configura o app autenticador no primeiro login.
usuariosRouter.post("/", h(async (req, res) => {
  const { nome, email, senha, role } = req.body || {};
  if (!nome || !email || !senha || !role) {
    return res.status(400).json({ erro: "nome, email, senha e role são obrigatórios" });
  }
  if (!validarRole(role)) return res.status(400).json({ erro: "role deve ser 'admin' ou 'atendente'" });
  if (String(senha).length < 8) return res.status(400).json({ erro: "senha deve ter ao menos 8 caracteres" });

  const emailNormalizado = String(email).toLowerCase().trim();
  const existente = await pool.query("SELECT id FROM usuario WHERE email = $1", [emailNormalizado]);
  if (existente.rows.length) return res.status(409).json({ erro: "já existe um usuário com esse e-mail" });

  const senhaHash = await hashSenha(senha);
  const mfaSecret = gerarSegredoMfa();
  const result = await pool.query(
    `INSERT INTO usuario (nome, email, senha_hash, role, mfa_secret)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${CAMPOS_PUBLICOS}`,
    [nome, emailNormalizado, senhaHash, role, mfaSecret]
  );
  await audit(req.usuario!.email, "usuarios.criado", result.rows[0].id);
  res.status(201).json(result.rows[0]);
}));

// PUT /v1/usuarios/:id — atualiza dados, troca senha e/ou reseta o MFA
// (obriga a reconfigurar o app autenticador no próximo login).
usuariosRouter.put("/:id", h(async (req, res) => {
  const { id } = req.params;
  const { nome, email, role, ativo, senha, resetar_mfa } = req.body || {};

  const atual = await pool.query("SELECT * FROM usuario WHERE id = $1", [id]);
  if (!atual.rows.length) return res.status(404).json({ erro: "usuário não encontrado" });

  if (role !== undefined && !validarRole(role)) {
    return res.status(400).json({ erro: "role deve ser 'admin' ou 'atendente'" });
  }
  if (ativo === false && id === req.usuario!.sub) {
    return res.status(400).json({ erro: "não é possível desativar a própria conta" });
  }

  const campos: string[] = [];
  const valores: unknown[] = [];
  const set = (coluna: string, valor: unknown) => {
    valores.push(valor);
    campos.push(`${coluna} = $${valores.length}`);
  };

  if (nome !== undefined) set("nome", nome);
  if (email !== undefined) set("email", String(email).toLowerCase().trim());
  if (role !== undefined) set("role", role);
  if (ativo !== undefined) set("ativo", !!ativo);
  if (senha) {
    if (String(senha).length < 8) return res.status(400).json({ erro: "senha deve ter ao menos 8 caracteres" });
    set("senha_hash", await hashSenha(senha));
  }
  if (resetar_mfa) {
    set("mfa_secret", gerarSegredoMfa());
    set("mfa_ativado", false);
  }

  if (!campos.length) return res.status(400).json({ erro: "nenhum campo para atualizar" });

  valores.push(id);
  const result = await pool.query(
    `UPDATE usuario SET ${campos.join(", ")} WHERE id = $${valores.length} RETURNING ${CAMPOS_PUBLICOS}`,
    valores
  );
  await audit(req.usuario!.email, "usuarios.atualizado", id);
  res.json(result.rows[0]);
}));

// DELETE /v1/usuarios/:id — remove a conta (não permite auto-exclusão, para
// nunca deixar o painel sem nenhum admin ativo por engano).
usuariosRouter.delete("/:id", h(async (req, res) => {
  const { id } = req.params;
  if (id === req.usuario!.sub) return res.status(400).json({ erro: "não é possível excluir a própria conta" });

  const result = await pool.query("DELETE FROM usuario WHERE id = $1 RETURNING id", [id]);
  if (!result.rows.length) return res.status(404).json({ erro: "usuário não encontrado" });
  await audit(req.usuario!.email, "usuarios.excluido", id);
  res.json({ ok: true });
}));
