import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import QRCode from "qrcode";

const JWT_SECRET = process.env.JWT_SECRET || "troque-este-segredo-em-producao";
const EMISSOR_MFA = "Claro Vox";

export type Role = "admin" | "atendente";

export interface TokenPayload {
  sub: string;
  nome: string;
  email: string;
  role: Role;
}

export interface LoginTokenPayload {
  sub: string;
  finalidade: "mfa";
}

// Senhas — nunca guardadas em texto puro (RNF de segurança, mesmo padrão do
// CPF hasheado em civ/src/crypto.ts).
export function hashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, 12);
}

export function compararSenha(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}

// Token de sessão final — emitido só depois da senha *e* do código MFA
// confirmados (RF de autenticação em duas etapas do painel Vox Briefing).
export function emitirToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

export function verificarToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}

// Token intermediário — só prova que a senha foi validada; de posse dele
// ainda falta o código MFA para virar uma sessão de verdade. Vida curta.
export function emitirLoginToken(usuarioId: string): string {
  return jwt.sign({ sub: usuarioId, finalidade: "mfa" } as LoginTokenPayload, JWT_SECRET, { expiresIn: "5m" });
}

export function verificarLoginToken(token: string): LoginTokenPayload {
  const payload = jwt.verify(token, JWT_SECRET) as LoginTokenPayload;
  if (payload.finalidade !== "mfa") throw new Error("token inválido");
  return payload;
}

// ---- MFA (TOTP, RFC 6238) — mesmo secret serve para gerar o QR de
// configuração e para validar os códigos de 6 dígitos depois. ------------
export function gerarSegredoMfa(): string {
  return authenticator.generateSecret();
}

export function otpauthUrl(email: string, segredo: string): string {
  return authenticator.keyuri(email, EMISSOR_MFA, segredo);
}

// Gera o QR localmente (data URL) — o segredo nunca sai da CIV para um
// serviço de terceiros só para desenhar o código.
export function gerarQrDataUrl(otpauthUrlValor: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrlValor, { margin: 1, width: 220 });
}

export function verificarCodigoMfa(codigo: string, segredo: string): boolean {
  try {
    return authenticator.check(String(codigo).trim(), segredo);
  } catch {
    return false;
  }
}
