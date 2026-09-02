import { useEffect, useRef, useState } from "react";
import { wsBriefingUrl } from "./api";

export interface WsEvent {
  type: string;
  payload: unknown;
  ts: string;
}

/**
 * Hook do painel "Vox Briefing" — mantém uma conexão WebSocket com a CIV
 * (RF007-009) e devolve o último evento recebido, para que os componentes
 * do painel do atendente possam re-consultar a API REST sempre que algo
 * mudar (sessão atualizada, mensagem nova, handoff criado/assumido/encerrado)
 * em vez de fazer polling constante.
 */
export function useBriefingSocket() {
  const [ultimoEvento, setUltimoEvento] = useState<WsEvent | null>(null);
  const [conectado, setConectado] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelado = false;
    let tentativa = 0;

    function conectar() {
      if (cancelado) return;
      const ws = new WebSocket(wsBriefingUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        tentativa = 0;
        setConectado(true);
      };
      ws.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data) as WsEvent;
          setUltimoEvento(parsed);
        } catch {
          /* ignora mensagens não-JSON */
        }
      };
      ws.onclose = () => {
        setConectado(false);
        if (cancelado) return;
        tentativa += 1;
        setTimeout(conectar, Math.min(1000 * tentativa, 5000));
      };
      ws.onerror = () => ws.close();
    }

    conectar();
    return () => {
      cancelado = true;
      wsRef.current?.close();
    };
  }, []);

  return { ultimoEvento, conectado };
}
