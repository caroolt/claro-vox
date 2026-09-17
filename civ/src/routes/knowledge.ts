import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { h } from "../asyncHandler";
import { requireAuth } from "../middleware/auth";
import { validateBody } from "../validate";

export const knowledgeRouter = Router();

const searchSchema = z.object({
  embedding: z.array(z.number(), { invalid_type_error: "embedding (array) é obrigatório" }),
  limite: z.number().int().positive().nullable().optional(),
});

// GET /v1/knowledge — painel "Base de Conhecimento (RAG)" do Vox Briefing (leitura)
knowledgeRouter.get("/", requireAuth, h(async (_req, res) => {
  const result = await pool.query("SELECT id, titulo, conteudo, categoria FROM knowledge_base ORDER BY titulo");
  res.json(result.rows);
}));

// POST /v1/knowledge/search — usado pelo Orquestrador para a busca vetorial
// via pgvector (distância de cosseno). O embedding é calculado no
// Orquestrador (Python) e enviado já pronto.
knowledgeRouter.post("/search", validateBody(searchSchema), h(async (req, res) => {
  const { embedding, limite } = req.body;
  const vetor = `[${embedding.join(",")}]`;
  const result = await pool.query(
    `SELECT id, titulo, conteudo, categoria, embedding <-> $1 AS distancia
     FROM knowledge_base ORDER BY embedding <-> $1 LIMIT $2`,
    [vetor, limite || 3]
  );
  res.json(result.rows);
}));
