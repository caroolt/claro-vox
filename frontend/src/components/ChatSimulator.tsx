import { useEffect, useRef, useState } from "react";
import { civ, orchestrator } from "../api";
import logoClaroVox from "../assets/claro-vox-logo.png";
import type { Canal } from "../types";
import { useBriefingSocket } from "../useBriefingSocket";

interface Bubble {
  id: string;
  de: "cliente" | "vox" | "sistema" | "atendente";
  texto: string;
  meta?: string;
  // Quando presente, renderiza a pesquisa de NPS logo abaixo desta bolha:
  // "ia" acompanha a mensagem de transbordo; "atendente" aparece quando o
  // atendente humano encerra a sessão.
  nps?: { alvo: "ia" | "atendente"; briefingId?: string | null };
}

const CANAIS: { valor: Canal; rotulo: string; icone: string }[] = [
  { valor: "whatsapp", rotulo: "WhatsApp", icone: "💬" },
  { valor: "site", rotulo: "Site", icone: "🌐" },
  { valor: "app", rotulo: "App Claro", icone: "📱" },
  { valor: "voz", rotulo: "Central de Voz", icone: "☎️" },
];

function uid() {
  return Math.random().toString(36).slice(2);
}

export function ChatSimulator() {
  const [canal, setCanal] = useState<Canal>("whatsapp");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [fase, setFase] = useState<"inicio" | "coldstart" | "ativa">("inicio");
  const [sessaoId, setSessaoId] = useState<string | null>(null);
  const [clienteNome, setClienteNome] = useState<string | null>(null);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [protocolo, setProtocolo] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [mostrarTrocaCanal, setMostrarTrocaCanal] = useState(false);
  const [cpfTroca, setCpfTroca] = useState("");
  const [atendimentoHumano, setAtendimentoHumano] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const { ultimoEvento } = useBriefingSocket();

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bubbles]);

  function add(de: Bubble["de"], texto: string, meta?: string, nps?: Bubble["nps"]) {
    setBubbles((b) => [...b, { id: uid(), de, texto, meta, nps }]);
  }

  // Ouve o WebSocket da CIV para receber, em tempo real, as mensagens que o
  // atendente humano digitar no painel do atendente (Vox Briefing) — elas
  // chegam aqui como remetente "atendente" e são exibidas em um balão vermelho
  // bem claro, para o cliente distinguir quando está falando com um humano.
  useEffect(() => {
    if (!ultimoEvento || !sessaoId) return;
    const payload = ultimoEvento.payload as { sessao_id?: string; remetente?: string; conteudo?: string } | undefined;
    if (payload?.sessao_id !== sessaoId) return;

    if (ultimoEvento.type === "message.created" && payload.remetente === "atendente" && payload.conteudo) {
      add("atendente", payload.conteudo);
    } else if (ultimoEvento.type === "handoff.assumed") {
      setAtendimentoHumano(true);
    } else if (ultimoEvento.type === "handoff.closed") {
      add("sistema", "Atendimento encerrado pelo atendente.", undefined, { alvo: "atendente" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultimoEvento]);

  async function iniciarConversa() {
    setCarregando(true);
    try {
      const r = await orchestrator.coldstartStart(canal, `${canal}-demo-${uid()}`);
      setSessaoId(r.sessao_id);
      setFase("coldstart");
      add("vox", r.proxima_pergunta);
    } catch (e: any) {
      add("sistema", `Erro ao iniciar sessão: ${e.message}`);
    } finally {
      setCarregando(false);
    }
  }

  async function enviar() {
    if (!input.trim() || carregando) return;
    const texto = input.trim();
    setInput("");
    add("cliente", texto);
    setCarregando(true);
    try {
      if (fase === "coldstart" && sessaoId) {
        const r = await orchestrator.coldstartAnswer(sessaoId, texto);
        if (r.estado === "ATIVA") {
          setFase("ativa");
          setClienteNome(r.cliente?.nome || null);
          setClienteId(r.cliente?.id || null);
          setProtocolo(r.protocolo || null);
          add("vox", r.mensagem);
        } else {
          add("vox", r.proxima_pergunta);
        }
      } else if (fase === "ativa" && sessaoId && atendimentoHumano) {
        // Um atendente humano já assumiu esta sessão: a mensagem só é
        // registrada, sem passar pelo Orquestrador/IA — quem responde a
        // partir daqui é o atendente, pelo chat do painel.
        await civ.enviarMensagem(sessaoId, "cliente", canal, texto);
      } else if (fase === "ativa" && sessaoId) {
        const r = await orchestrator.message(sessaoId, canal, texto);
        const meta = `intenção: ${r.categoria} · tom: ${r.tom_emocional}${r.fonte_classificacao === "llm" ? " · classificado pelo Claude" : ""}`;
        add("vox", r.resposta, meta, r.transbordo ? { alvo: "ia", briefingId: r.briefing_id } : undefined);
        if (r.transbordo) {
          add("sistema", `🔁 Transbordo acionado — briefing #${String(r.briefing_id).slice(0, 8)} enviado ao painel do atendente (Vox Briefing).`);
        }
      }
    } catch (e: any) {
      add("sistema", `Erro: ${e.message}`);
    } finally {
      setCarregando(false);
    }
  }

  async function trocarCanal(novoCanal: Canal) {
    if (fase !== "ativa") {
      setCanal(novoCanal);
      return;
    }
    setMostrarTrocaCanal(true);
    setCanal(novoCanal);
  }

  async function confirmarTrocaCanal() {
    if (!cpfTroca.trim()) return;
    setCarregando(true);
    try {
      const r = await orchestrator.coldstartReconhecer(canal, cpfTroca.trim());
      if (r.reconhecido) {
        setSessaoId(r.sessao_id);
        setClienteNome(r.cliente?.nome || null);
        setClienteId(r.cliente?.id || null);
        setProtocolo(r.protocolo || null);
        add("sistema", `📡 Reconhecido automaticamente no canal ${canal} (RF004) — contexto trazido do canal anterior: ${r.canal_anterior || "nenhum"}.`);
        add("vox", r.mensagem);
      } else {
        add("sistema", "CPF não encontrado — iniciando um novo atendimento (Cold Start) neste canal.");
        setFase("inicio");
        setSessaoId(null);
      }
    } catch (e: any) {
      add("sistema", `Erro ao reconhecer cliente: ${e.message}`);
    } finally {
      setMostrarTrocaCanal(false);
      setCpfTroca("");
      setCarregando(false);
    }
  }

  async function excluirDados() {
    if (!clienteId) return;
    if (!confirm("Confirma a exclusão dos dados deste cliente (LGPD art. 18)? Esta ação é irreversível.")) return;
    setCarregando(true);
    try {
      await civ.excluirCliente(clienteId);
      add("sistema", "🗑️ Dados do titular anonimizados conforme art. 18 da LGPD (direito de exclusão).");
    } catch (e: any) {
      add("sistema", `Erro ao excluir dados: ${e.message}`);
    } finally {
      setCarregando(false);
    }
  }

  function reiniciar() {
    setBubbles([]);
    setFase("inicio");
    setSessaoId(null);
    setClienteNome(null);
    setClienteId(null);
    setProtocolo(null);
    setMostrarTrocaCanal(false);
    setAtendimentoHumano(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500 mr-1">Canal:</span>
          {CANAIS.map((c) => (
            <button
              key={c.valor}
              onClick={() => trocarCanal(c.valor)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                canal === c.valor
                  ? "bg-claro-red text-white border-claro-red"
                  : "bg-white text-gray-600 border-gray-300 hover:border-claro-red"
              }`}
            >
              {c.icone} {c.rotulo}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {clienteNome && <span className="text-sm text-gray-500">👤 {clienteNome}</span>}
          {protocolo && (
            <span className="rounded-full bg-claro-red-light px-2.5 py-1 text-xs font-medium text-claro-red-dark">
              protocolo {protocolo}
            </span>
          )}
          {clienteId && (
            <button onClick={excluirDados} className="text-xs text-gray-400 hover:text-claro-red underline">
              Excluir meus dados (LGPD)
            </button>
          )}
          <button onClick={reiniciar} className="text-xs text-gray-400 hover:text-claro-red underline">
            Reiniciar
          </button>
        </div>
      </div>

      {mostrarTrocaCanal && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3 flex items-center gap-2">
          <span className="text-sm text-yellow-800">
            Simulando contato pelo canal <strong>{canal}</strong>: informe o CPF para reconhecimento automático (RF004)
          </span>
          <input
            value={cpfTroca}
            onChange={(e) => setCpfTroca(e.target.value)}
            placeholder="000.000.000-00"
            className="border border-yellow-300 rounded px-2 py-1 text-sm"
          />
          <button
            onClick={confirmarTrocaCanal}
            disabled={carregando}
            className="bg-claro-red text-white text-sm px-3 py-1 rounded disabled:opacity-50"
          >
            Confirmar
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50">
        {bubbles.length === 0 && fase === "inicio" && (
          <div className="text-center text-gray-400 mt-16">
            <span className="mb-3 inline-flex rounded-xl bg-claro-black px-4 py-2.5">
              <img src={logoClaroVox} alt="Claro Vox" className="h-8 w-auto" />
            </span>
            <p className="text-lg mb-2">Simulador de atendimento</p>
            <p className="text-sm mb-6">Escolha um canal acima e inicie a conversa para ver o Cold Start (RF010/RF011) em ação.</p>
            <button
              onClick={iniciarConversa}
              disabled={carregando}
              className="bg-claro-red text-white px-5 py-2 rounded-full font-medium disabled:opacity-50"
            >
              Iniciar conversa
            </button>
          </div>
        )}
        {bubbles.map((b) => (
          <div key={b.id} className="space-y-3">
            <div className={`flex ${b.de === "cliente" ? "justify-end" : "justify-start"}`}>
              {b.de === "sistema" ? (
                <div className="mx-auto text-xs text-center text-gray-500 bg-gray-200 rounded-full px-3 py-1">{b.texto}</div>
              ) : (
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                    b.de === "cliente"
                      ? "bg-claro-red text-white rounded-br-sm"
                      : b.de === "atendente"
                      ? "bg-claro-red-light text-gray-800 rounded-bl-sm border border-claro-red/20"
                      : "bg-white text-gray-800 rounded-bl-sm border border-gray-200"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{b.texto}</p>
                  {b.meta && <p className={`mt-1 text-[11px] ${b.de === "cliente" ? "text-red-100" : "text-gray-400"}`}>{b.meta}</p>}
                </div>
              )}
            </div>
            {b.nps && sessaoId && (
              <NpsInline sessaoId={sessaoId} alvo={b.nps.alvo} briefingId={b.nps.briefingId} />
            )}
          </div>
        ))}
        <div ref={fimRef} />
      </div>

      {fase !== "inicio" && (
        <div className="border-t border-gray-200 bg-white p-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enviar()}
            placeholder="Digite sua mensagem…"
            disabled={carregando}
            className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-claro-red"
          />
          <button
            onClick={enviar}
            disabled={carregando || !input.trim()}
            className="bg-claro-red text-white px-5 py-2 rounded-full text-sm font-medium disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
      )}
    </div>
  );
}

// Pesquisa de NPS embutida no chat do cliente. Para o alvo "ia" a pergunta
// já vem na própria mensagem de transbordo, então aqui só mostramos a escala;
// para o alvo "atendente" incluímos a pergunta. Uma vez enviada (ou dispensada)
// a pesquisa some, deixando só um agradecimento.
function NpsInline({
  sessaoId,
  alvo,
  briefingId,
}: {
  sessaoId: string;
  alvo: "ia" | "atendente";
  briefingId?: string | null;
}) {
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState("");
  const [estado, setEstado] = useState<"aberta" | "enviando" | "enviada" | "dispensada">("aberta");

  async function enviar() {
    if (nota === null) return;
    setEstado("enviando");
    try {
      await civ.nps({
        sessao_id: sessaoId,
        alvo,
        nota,
        comentario: comentario.trim() || undefined,
        briefing_id: briefingId ?? undefined,
      });
      setEstado("enviada");
    } catch {
      setEstado("aberta");
    }
  }

  if (estado === "enviada") {
    return (
      <div className="mx-auto rounded-full bg-green-50 px-3 py-1 text-center text-xs text-green-700">
        ✓ Obrigado pela sua avaliação!
      </div>
    );
  }
  if (estado === "dispensada") {
    return (
      <div className="mx-auto rounded-full bg-gray-100 px-3 py-1 text-center text-xs text-gray-400">
        Avaliação dispensada.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-medium text-gray-700">
        {alvo === "ia"
          ? "Sua avaliação do assistente virtual:"
          : "De 0 a 10, o quanto você recomendaria o atendimento do nosso atendente?"}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {Array.from({ length: 11 }, (_, i) => i).map((n) => (
          <button
            key={n}
            onClick={() => setNota(n)}
            className={`h-7 w-7 rounded-full text-xs font-medium transition ${
              nota === n
                ? "bg-claro-red text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400">
        <span>nada provável</span>
        <span>muito provável</span>
      </div>
      {nota !== null && (
        <>
          <textarea
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="Quer contar o porquê? (opcional)"
            rows={2}
            className="mt-2 w-full resize-none rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-claro-red focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-end gap-3">
            <button
              onClick={() => setEstado("dispensada")}
              className="text-[11px] text-gray-400 underline hover:text-gray-600"
            >
              Pular
            </button>
            <button
              onClick={enviar}
              disabled={estado === "enviando"}
              className="rounded-full bg-claro-red px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {estado === "enviando" ? "Enviando…" : "Enviar avaliação"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
