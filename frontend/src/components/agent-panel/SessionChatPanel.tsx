import { useEffect, useRef, useState } from "react";
import { civ } from "../../api";
import type { KnowledgeItem, Mensagem } from "../../types";
import type { WsEvent } from "../../useBriefingSocket";
import { exportarConversaPdf } from "./exportar";

// Respostas fixas para padronizar o tom do atendimento humano.
const RESPOSTAS_PADRAO: { rotulo: string; texto: string }[] = [
  {
    rotulo: "Abertura",
    texto:
      "Olá! Aqui é um atendente da Claro e vou continuar seu atendimento a partir de agora. Já estou com todo o histórico da conversa, não precisa repetir nada.",
  },
  { rotulo: "Um momento", texto: "Só um momento, por favor — estou verificando isso no sistema." },
  { rotulo: "Confirmar", texto: "Consegui resolver o que você precisava? Posso ajudar com mais alguma coisa?" },
  { rotulo: "Encerramento", texto: "Obrigado pelo contato com a Claro! Qualquer coisa, é só chamar. Tenha um ótimo dia." },
];

export function SessionChatPanel({
  sessaoId,
  clienteNome,
  canal,
  ultimoEvento,
  onClose,
}: {
  sessaoId: string;
  clienteNome: string | null;
  canal: string;
  ultimoEvento: WsEvent | null;
  onClose: () => void;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [sugestoes, setSugestoes] = useState<KnowledgeItem[]>([]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  async function carregar() {
    const [msgs, sug] = await Promise.all([civ.sessionMessages(sessaoId), civ.sessionSuggestions(sessaoId)]);
    setMensagens(msgs);
    setSugestoes(sug.itens);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessaoId]);

  useEffect(() => {
    const payload = ultimoEvento?.payload as { sessao_id?: string } | undefined;
    if (ultimoEvento?.type === "message.created" && payload?.sessao_id === sessaoId) {
      carregar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultimoEvento]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  function usarSugestao(texto: string) {
    setInput(texto);
    campoRef.current?.focus();
  }

  async function exportarPdf() {
    setExportando(true);
    try {
      await exportarConversaPdf(sessaoId);
    } finally {
      setExportando(false);
    }
  }

  async function enviar() {
    if (!input.trim() || enviando) return;
    const texto = input.trim();
    setInput("");
    setEnviando(true);
    try {
      await civ.enviarMensagem(sessaoId, "atendente", canal, texto);
      await carregar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="mx-4 flex h-[70vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div>
              <h3 className="font-semibold text-gray-800">Chat com {clienteNome || "cliente"}</h3>
              <p className="text-xs text-gray-400">
                canal: {canal} · suas mensagens chegam ao cliente identificadas como atendente
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={exportarPdf}
                disabled={exportando}
                className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:border-claro-red hover:text-claro-red disabled:opacity-50"
              >
                {exportando ? "gerando…" : "⬇ Exportar PDF"}
              </button>
              <button onClick={onClose} className="text-lg leading-none text-gray-400 hover:text-gray-600">
                ×
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto bg-gray-50 px-4 py-3">
            {mensagens.map((m) => {
              const estilo =
                m.remetente === "cliente"
                  ? "rounded-bl-sm border border-gray-200 bg-white text-gray-800"
                  : m.remetente === "atendente"
                  ? "rounded-br-sm border border-claro-red/20 bg-claro-red-light text-gray-800"
                  : "rounded-br-sm bg-claro-red text-white";
              const metaCor = m.remetente === "vox" ? "text-red-100" : "text-gray-400";
              return (
                <div key={m.id} className={`flex ${m.remetente === "cliente" ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${estilo}`}>
                    <p className="whitespace-pre-wrap">{m.conteudo}</p>
                    <p className={`mt-0.5 text-[10px] ${metaCor}`}>
                      {m.remetente === "cliente" ? "cliente" : m.remetente === "atendente" ? "você (atendente)" : "vox (IA)"}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={fimRef} />
          </div>

          <div className="flex items-end gap-2 border-t border-gray-200 p-3">
            <textarea
              ref={campoRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviar();
                }
              }}
              rows={2}
              placeholder="Responder como atendente… (Enter envia, Shift+Enter quebra linha)"
              disabled={enviando}
              className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-claro-red focus:outline-none"
            />
            <button
              onClick={enviar}
              disabled={enviando || !input.trim()}
              className="rounded-full bg-claro-red px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Enviar
            </button>
          </div>
        </div>

        <aside className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-200 bg-gray-50 p-3 md:flex">
          <div>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Respostas padrão</h4>
            <div className="space-y-1.5">
              {RESPOSTAS_PADRAO.map((r) => (
                <button
                  key={r.rotulo}
                  onClick={() => usarSugestao(r.texto)}
                  className="w-full rounded-lg border border-gray-200 bg-white p-2 text-left hover:border-claro-red"
                >
                  <span className="text-xs font-medium text-gray-700">{r.rotulo}</span>
                  <span className="mt-0.5 line-clamp-2 block text-[11px] text-gray-400">{r.texto}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Da base de conhecimento</h4>
            <div className="space-y-1.5">
              {sugestoes.map((s) => (
                <button
                  key={s.id}
                  onClick={() => usarSugestao(s.conteudo)}
                  className="w-full rounded-lg border border-gray-200 bg-white p-2 text-left hover:border-claro-red"
                >
                  <span className="text-xs font-medium text-gray-700">{s.titulo}</span>
                  <span className="mt-0.5 line-clamp-3 block text-[11px] text-gray-400">{s.conteudo}</span>
                </button>
              ))}
              {sugestoes.length === 0 && <p className="text-[11px] text-gray-400">Sem sugestões no momento.</p>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
