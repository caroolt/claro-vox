import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Globe,
  MessageCircle,
  Phone,
  RotateCcw,
  Send,
  Smartphone,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { civ, orchestrator } from "../api";
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

const CANAIS: { valor: Canal; rotulo: string; icone: LucideIcon }[] = [
  { valor: "whatsapp", rotulo: "WhatsApp", icone: MessageCircle },
  { valor: "site", rotulo: "Site", icone: Globe },
  { valor: "app", rotulo: "App Claro", icone: Smartphone },
  { valor: "voz", rotulo: "Central de Voz", icone: Phone },
];

function uid() {
  return Math.random().toString(36).slice(2);
}

// Identificador do "aparelho" simulado — gerado uma vez e persistido no
// navegador, como o app/site real faria. É o sinal cross-identidade que a
// camada de detecção de fraude usa para ligar clientes de CPFs diferentes
// que compartilham o mesmo dispositivo (Regra B, ver civ/schema.sql).
function obterDispositivoId(): string {
  const chave = "vox_dispositivo_id";
  try {
    let id = localStorage.getItem(chave);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(chave, id);
    }
    return id;
  } catch {
    return uid();
  }
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
      const r = await orchestrator.coldstartStart(canal, `${canal}-demo-${uid()}`, undefined, obterDispositivoId());
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
          add("sistema", `🔁 Transbordo acionado: briefing #${String(r.briefing_id).slice(0, 8)} enviado ao painel do atendente (Vox Briefing).`);
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
      const r = await orchestrator.coldstartReconhecer(canal, cpfTroca.trim(), obterDispositivoId());
      if (r.reconhecido) {
        setSessaoId(r.sessao_id);
        setClienteNome(r.cliente?.nome || null);
        setClienteId(r.cliente?.id || null);
        setProtocolo(r.protocolo || null);
        add("sistema", `📡 Reconhecido automaticamente no canal ${canal} (RF004), trazendo o contexto do canal anterior: ${r.canal_anterior || "nenhum"}.`);
        add("vox", r.mensagem);
      } else {
        add("sistema", "CPF não encontrado. Iniciando um novo atendimento (Cold Start) neste canal.");
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

  const canalAtual = CANAIS.find((c) => c.valor === canal) || CANAIS[0];

  return (
    <div className="flex h-full flex-col bg-claro-gray-light">
      {/* Barra de controle do simulador — não faz parte do "aparelho" do cliente */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-gray-400">Canal</span>
          {CANAIS.map((c) => (
            <button
              key={c.valor}
              onClick={() => trocarCanal(c.valor)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                canal === c.valor
                  ? "border-claro-red bg-claro-red text-white"
                  : "border-gray-300 bg-white text-gray-600 hover:border-claro-red hover:text-claro-red"
              }`}
            >
              <c.icone className="h-3.5 w-3.5" strokeWidth={2.25} />
              {c.rotulo}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {clienteId && (
            <button
              onClick={excluirDados}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-claro-red"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              Excluir meus dados (LGPD)
            </button>
          )}
          <button
            onClick={reiniciar}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-claro-red"
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
            Reiniciar
          </button>
        </div>
      </div>

      {mostrarTrocaCanal && (
        <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={2} />
          <span className="text-sm text-amber-800">
            Simulando contato pelo canal <strong>{canalAtual.rotulo}</strong>: informe o CPF para reconhecimento
            automático (RF004)
          </span>
          <input
            value={cpfTroca}
            onChange={(e) => setCpfTroca(e.target.value)}
            placeholder="000.000.000-00"
            className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-sm focus:border-claro-red focus:outline-none"
          />
          <button
            onClick={confirmarTrocaCanal}
            disabled={carregando}
            className="rounded-lg bg-claro-red px-3 py-1.5 text-sm font-medium text-white hover:bg-claro-red-dark disabled:opacity-50"
          >
            Confirmar
          </button>
        </div>
      )}

      {/* "Aparelho" do cliente — janela de chat centralizada, como um app real */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
        <div className="flex h-full min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center gap-3 bg-claro-black px-4 py-3 text-white">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
              <Bot className="h-4 w-4 text-claro-red" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">Vox · Assistente Claro</p>
              <p className="flex items-center gap-1.5 text-[11px] text-white/50">
                <span className="h-1.5 w-1.5 rounded-full bg-status-good" />
                <canalAtual.icone className="h-3 w-3" strokeWidth={2} />
                {canalAtual.rotulo}
              </p>
            </div>
            {clienteNome && (
              <span className="hidden max-w-[9rem] truncate text-xs text-white/60 sm:inline">{clienteNome}</span>
            )}
            {protocolo && (
              <span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[11px] font-medium text-white/80">
                {protocolo}
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-claro-gray-light px-4 py-4">
            {bubbles.length === 0 && fase === "inicio" && (
              <div className="mt-16 text-center text-gray-400">
                <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-claro-red-light">
                  <Bot className="h-6 w-6 text-claro-red" strokeWidth={2} />
                </span>
                <p className="mb-2 text-lg text-gray-600">Simulador de atendimento</p>
                <p className="mb-6 px-6 text-sm">
                  Escolha um canal acima e inicie a conversa para ver o Cold Start (RF010/RF011) em ação.
                </p>
                <button
                  onClick={iniciarConversa}
                  disabled={carregando}
                  className="rounded-full bg-claro-red px-5 py-2 font-medium text-white transition hover:bg-claro-red-dark disabled:opacity-50"
                >
                  Iniciar conversa
                </button>
              </div>
            )}
            {bubbles.map((b) => (
              <div key={b.id} className="space-y-3">
                <div className={`flex items-end gap-2 ${b.de === "cliente" ? "justify-end" : "justify-start"}`}>
                  {b.de === "sistema" ? (
                    <div className="mx-auto rounded-full bg-gray-200 px-3 py-1 text-center text-xs text-gray-500">
                      {b.texto}
                    </div>
                  ) : (
                    <>
                      {b.de === "vox" && (
                        <span className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-claro-black text-white">
                          <Bot className="h-3.5 w-3.5" strokeWidth={2} />
                        </span>
                      )}
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                          b.de === "cliente"
                            ? "rounded-br-sm bg-claro-red text-white"
                            : b.de === "atendente"
                            ? "rounded-bl-sm border border-claro-red/20 bg-claro-red-light text-gray-800"
                            : "rounded-bl-sm border border-gray-200 bg-white text-gray-800"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{b.texto}</p>
                        {b.meta && (
                          <p className={`mt-1 text-[11px] ${b.de === "cliente" ? "text-red-100" : "text-gray-400"}`}>
                            {b.meta}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {b.nps && sessaoId && <NpsInline sessaoId={sessaoId} alvo={b.nps.alvo} briefingId={b.nps.briefingId} />}
              </div>
            ))}
            <div ref={fimRef} />
          </div>

          {fase !== "inicio" && (
            <div className="flex gap-2 border-t border-gray-200 bg-white p-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && enviar()}
                placeholder="Digite sua mensagem…"
                disabled={carregando}
                className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm focus:border-claro-red focus:outline-none"
              />
              <button
                onClick={enviar}
                disabled={carregando || !input.trim()}
                className="flex items-center gap-1.5 rounded-full bg-claro-red px-4 py-2 text-sm font-medium text-white transition hover:bg-claro-red-dark disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" strokeWidth={2.25} />
                Enviar
              </button>
            </div>
          )}
        </div>
      </div>
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
