import { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodSchema } from "zod";

// Middlewares de validação de schema — aplicados por rota (ver cada
// arquivo em src/routes). Em caso de falha, devolve 400 no mesmo formato
// de erro já usado nas rotas (`{ erro }`), com `detalhes` extra descrevendo
// o que exatamente veio inválido.
export function validateBody(schema: ZodSchema): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const resultado = schema.safeParse(req.body);
    if (!resultado.success) {
      return res.status(400).json({ erro: "dados inválidos", detalhes: resultado.error.flatten() });
    }
    req.body = resultado.data;
    next();
  };
}

export function validateQuery(schema: ZodSchema): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const resultado = schema.safeParse(req.query);
    if (!resultado.success) {
      return res.status(400).json({ erro: "parâmetros inválidos", detalhes: resultado.error.flatten() });
    }
    Object.assign(req.query, resultado.data);
    next();
  };
}
