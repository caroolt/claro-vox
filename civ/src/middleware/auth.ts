import { Request, Response, NextFunction } from "express";
import { Role, TokenPayload, verificarToken } from "../auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: TokenPayload;
    }
  }
}

// Protege as rotas do Painel do Atendente (Vox Briefing) — exige o token
// final emitido só depois de senha + código MFA confirmados. O simulador de
// cliente e as chamadas internas do Orquestrador não passam por aqui.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const [tipo, token] = header.split(" ");
  if (tipo !== "Bearer" || !token) {
    return res.status(401).json({ erro: "autenticação necessária" });
  }
  try {
    req.usuario = verificarToken(token);
    next();
  } catch {
    return res.status(401).json({ erro: "sessão inválida ou expirada" });
  }
}

// RBAC — algumas abas/rotas do painel (ex.: Visão Geral, gerenciar
// atendentes) são exclusivas da role admin.
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario) return res.status(401).json({ erro: "autenticação necessária" });
    if (!roles.includes(req.usuario.role)) {
      return res.status(403).json({ erro: "sem permissão para este recurso" });
    }
    next();
  };
}
