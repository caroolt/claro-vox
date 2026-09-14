import { Router } from "express";
import { pool } from "../db";
import { h } from "../asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";

export const auditoriaRouter = Router();

const LIMITE_PADRAO = 50;

// GET /v1/auditoria — alimenta o card de auditoria da aba "Visão geral"
// (exclusiva da role admin), listando as ações sensíveis mais recentes já
// registradas pelo helper `audit()` em todas as rotas da CIV (login, MFA,
// CRUD de usuários, exclusão LGPD, export de transcript, handoff etc.).
auditoriaRouter.get("/", requireAuth, requireRole("admin"), h(async (_req, res) => {
  const result = await pool.query(
    `SELECT id, ator, acao, recurso_id, timestamp
     FROM auditoria
     ORDER BY timestamp DESC
     LIMIT ${LIMITE_PADRAO}`
  );
  res.json(result.rows);
}));
