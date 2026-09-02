import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { coldstartRouter } from "./routes/coldstart";
import { sessionsRouter } from "./routes/sessions";
import { handoffRouter } from "./routes/handoff";
import { knowledgeRouter } from "./routes/knowledge";
import { metricsRouter } from "./routes/metrics";
import { clientesRouter } from "./routes/clientes";
import { initWs } from "./ws";
import { pool } from "./db";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", servico: "civ" });
  } catch (e) {
    res.status(503).json({ status: "degraded", erro: (e as Error).message });
  }
});

app.use("/v1/coldstart", coldstartRouter);
app.use("/v1/sessions", sessionsRouter);
app.use("/v1/handoff", handoffRouter);
app.use("/v1/knowledge", knowledgeRouter);
app.use("/v1/metrics", metricsRouter);
app.use("/v1/clientes", clientesRouter);

// Middleware de erro global — qualquer exceção das rotas (via asyncHandler)
// vira uma resposta JSON 500 em vez de derrubar o processo.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[civ] erro não tratado:", err);
  res.status(500).json({ erro: "erro interno na CIV", detalhe: err?.message });
});

const PORT = Number(process.env.PORT) || 4001;
const server = http.createServer(app);
initWs(server);

server.listen(PORT, () => {
  console.log(`[civ] Camada de Identidade Vox ouvindo em http://localhost:${PORT}`);
});
