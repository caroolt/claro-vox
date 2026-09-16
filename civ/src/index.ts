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
import { npsRouter } from "./routes/nps";
import { authRouter } from "./routes/auth";
import { usuariosRouter } from "./routes/usuarios";
import { contratosRouter } from "./routes/contratos";
import { auditoriaRouter } from "./routes/auditoria";
import { configuracoesRouter } from "./routes/configuracoes";
import { fraudeRouter } from "./routes/fraude";
import { verificarTimeoutsAtendente } from "./jobs/timeoutAtendente";
import { rodarDeteccaoFraudePeriodica } from "./jobs/deteccaoFraude";
import { initWs } from "./ws";
import { pool, ensureSchema } from "./db";

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
app.use("/v1/nps", npsRouter);
app.use("/v1/auth", authRouter);
app.use("/v1/usuarios", usuariosRouter);
app.use("/v1/contratos", contratosRouter);
app.use("/v1/auditoria", auditoriaRouter);
app.use("/v1/configuracoes", configuracoesRouter);
app.use("/v1/fraude", fraudeRouter);

// Middleware de erro global — qualquer exceção das rotas (via asyncHandler)
// vira uma resposta JSON 500 em vez de derrubar o processo.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[civ] erro não tratado:", err);
  res.status(500).json({ erro: "erro interno na CIV", detalhe: err?.message });
});

const PORT = Number(process.env.PORT) || 4001;
const server = http.createServer(app);
initWs(server);

server.listen(PORT, async () => {
  console.log(`[civ] Camada de Identidade Vox ouvindo em http://localhost:${PORT}`);
  try {
    await ensureSchema();
  } catch (e) {
    console.error("[civ] falha ao garantir schema incremental:", (e as Error).message);
  }
  // Checa a cada minuto — granularidade suficiente pra um timeout medido em
  // minutos, sem gerar carga desnecessária no banco.
  setInterval(verificarTimeoutsAtendente, 60_000);
  // Regras B/C (dispositivo/IP e estilo de escrita) não têm um gatilho de
  // evento óbvio como a Regra A (checada em tempo real na contratação) —
  // roda periodicamente pra alertas novos aparecerem nos painéis conectados
  // sem depender de alguém abrir a aba Fraude na hora certa.
  setInterval(rodarDeteccaoFraudePeriodica, 60_000);
});
