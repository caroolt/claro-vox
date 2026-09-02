import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

let wss: WebSocketServer | null = null;

export function initWs(server: Server) {
  wss = new WebSocketServer({ server, path: "/ws/briefing" });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "connected", message: "Vox Briefing conectado em tempo real" }));
  });
  console.log("[ws] Vox Briefing WebSocket pronto em /ws/briefing");
}

// Notifica todos os paineis de atendente conectados — usado quando uma
// sessao muda de estado, uma mensagem chega ou um briefing e gerado.
export function broadcast(event: string, payload: unknown) {
  if (!wss) return;
  const data = JSON.stringify({ type: event, payload, ts: new Date().toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}
