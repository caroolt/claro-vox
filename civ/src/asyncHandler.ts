import { Request, Response, NextFunction, RequestHandler } from "express";

// Node encerra o processo em promises rejeitadas sem catch — esse wrapper
// garante que todo erro assíncrono de rota vire uma resposta 500 em JSON
// em vez de derrubar o serviço inteiro.
export function h(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
