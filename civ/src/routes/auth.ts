import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db";
import { h } from "../asyncHandler";
import { requireAuth } from "../middleware/auth";
import { validateBody } from "../validate";
import {
  compararSenha,
  emitirLoginToken,
  emitirToken,
  gerarQrDataUrl,
  otpauthUrl,
  verificarCodigoMfa,
  verificarLoginToken,
} from "../auth";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().min(1, "email é obrigatório"),
  senha: z.string().min(1, "senha é obrigatória"),
});

const mfaSchema = z.object({
  login_token: z.string().min(1, "login_token é obrigatório"),
  codigo: z.string().min(1, "codigo é obrigatório"),
});

// POST /v1/auth/login — 1ª etapa: e-mail + senha. Nunca devolve um token de
// sessão diretamente; sempre exige o código MFA na 2ª etapa (POST
// /v1/auth/mfa/verificar), mesmo para quem já configurou o autenticador.
authRouter.post("/login", validateBody(loginSchema), h(async (req, res) => {
  const { email, senha } = req.body;

  const result = await pool.query(
    "SELECT * FROM usuario WHERE email = $1 AND ativo = true",
    [String(email).toLowerCase().trim()]
  );
  const usuario = result.rows[0];
  if (!usuario || !(await compararSenha(senha, usuario.senha_hash))) {
    await audit(String(email), "auth.login.falhou");
    return res.status(401).json({ erro: "credenciais inválidas" });
  }

  const login_token = emitirLoginToken(usuario.id);
  if (!usuario.mfa_ativado) {
    // Primeiro acesso — ainda não configurou o app autenticador. Devolve o
    // QR (gerado localmente, o segredo não sai da CIV) para o front mostrar
    // antes de pedir o primeiro código.
    const url = otpauthUrl(usuario.email, usuario.mfa_secret);
    return res.json({
      etapa: "mfa_configuracao",
      login_token,
      otpauth_url: url,
      mfa_qr_data_url: await gerarQrDataUrl(url),
      mfa_secret: usuario.mfa_secret,
    });
  }
  return res.json({ etapa: "mfa", login_token });
}));

// POST /v1/auth/mfa/verificar — 2ª etapa: código de 6 dígitos do app
// autenticador (TOTP). Na primeira vez, um código válido também ativa o MFA
// da conta (finaliza a configuração iniciada no /login).
authRouter.post("/mfa/verificar", validateBody(mfaSchema), h(async (req, res) => {
  const { login_token, codigo } = req.body;

  let usuarioId: string;
  try {
    usuarioId = verificarLoginToken(login_token).sub;
  } catch {
    return res.status(401).json({ erro: "login expirado, refaça o passo de e-mail e senha" });
  }

  const result = await pool.query("SELECT * FROM usuario WHERE id = $1 AND ativo = true", [usuarioId]);
  const usuario = result.rows[0];
  if (!usuario) return res.status(401).json({ erro: "usuário não encontrado" });

  if (!verificarCodigoMfa(codigo, usuario.mfa_secret)) {
    await audit(usuario.email, "auth.mfa.codigo_invalido");
    return res.status(401).json({ erro: "código MFA inválido" });
  }

  if (!usuario.mfa_ativado) {
    await pool.query("UPDATE usuario SET mfa_ativado = true WHERE id = $1", [usuario.id]);
  }

  const token = emitirToken({ sub: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role });
  await audit(usuario.email, "auth.login");
  res.json({
    token,
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role },
  });
}));

// GET /v1/auth/me — confirma a sessão atual (usado pelo front ao recarregar
// a página, para restaurar o usuário logado sem pedir login de novo).
authRouter.get("/me", requireAuth, h(async (req, res) => {
  const result = await pool.query(
    "SELECT id, nome, email, role FROM usuario WHERE id = $1 AND ativo = true",
    [req.usuario!.sub]
  );
  if (!result.rows.length) return res.status(401).json({ erro: "usuário não encontrado ou inativo" });
  res.json(result.rows[0]);
}));
