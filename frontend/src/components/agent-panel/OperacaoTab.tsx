import { useEffect, useState } from "react";
import { ChevronRight, Headset, Radio, Search, ShieldAlert, X } from "lucide-react";
import { civ } from "../../api";
import type { Briefing, ClienteAlerta, SessaoResumo } from "../../types";
import {
  CANAL_META,
  CANAL_ORDEM,
  ehHoje,
  ESTADO_META,
  ESTADO_ORDEM,
  FILTROS_VAZIOS,
  filtrosAtivos,
  type FiltrosOperacao,
  pareceCpf,
  TOM_META,
  TOM_ORDEM,
  tomDaSessao,
} from "./meta";
import { CanalTag, EstadoBadge, NomeCliente, SectionTitle, TomBadge } from "./ui";

export function OperacaoTab({
  sessoes,
  fila,
  filtros,
  setFiltros,
  onAbrirCliente,
  onResponder,
  onAbrirBriefing,
  onAbrirChat,
  onAbrirFraude,
}: {
  sessoes: SessaoResumo[];
  fila: Briefing[];
  filtros: FiltrosOperacao;
  setFiltros: (f: FiltrosOperacao) => void;
  onAbrirCliente: (id: string) => void;
  onResponder: (b: Briefing) => void;
  onAbrirBriefing: (b: Briefing) => void;
  onAbrirChat: (s: { id: string; clienteNome: string | null; canal: string }) => void;
  onAbrirFraude: (clienteNome?: string | null) => void;
}) {
  const [filaTab, setFilaTab] = useState<"pendentes" | "todos">("pendentes");
  const [idsPorCpf, setIdsPorCpf] = useState<Set<string> | null>(null);
  const [buscandoCpf, setBuscandoCpf] = useState(false);
  const [alertasPorCliente, setAlertasPorCliente] = useState<Record<string, ClienteAlerta>>({});

  // Alertas de comportamento (hostilidade/urgência/chamados na semana) para
  // os clientes da fila de transbordo. Refeito só quando o conjunto de
  // clientes muda, não a cada refresh de 8s do painel.
  const idsClientesFila = [...new Set(fila.map((b) => b.cliente_id).filter((id): id is string => !!id))].sort();
  const chaveIds = idsClientesFila.join(",");
  useEffect(() => {
    if (!idsClientesFila.length) {
      setAlertasPorCliente({});
      return;
    }
    let cancelado = false;
    civ.clientesAlertas(idsClientesFila).then((alertas) => {
      if (cancelado) return;
      const porCliente: Record<string, ClienteAlerta> = {};
      alertas.forEach((a) => (porCliente[a.cliente_id] = a));
      setAlertasPorCliente(porCliente);
    });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveIds]);

  const termo = filtros.busca.trim();
  const buscaPorCpf = pareceCpf(termo);

  // Resolve a busca por CPF no backend (match por hash) — debounce simples.
  useEffect(() => {
    if (!buscaPorCpf) {
      setIdsPorCpf(null);
      setBuscandoCpf(false);
      return;
    }
    setBuscandoCpf(true);
    const t = setTimeout(async () => {
      try {
        const achados = await civ.clientesBuscar({ cpf: termo });
        setIdsPorCpf(new Set(achados.map((c) => c.id)));
      } catch {
        setIdsPorCpf(new Set());
      } finally {
        setBuscandoCpf(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [termo, buscaPorCpf]);

  function passaBusca(nome: string | null, clienteId: string | null): boolean {
    if (!termo) return true;
    if (buscaPorCpf) return !!clienteId && !!idsPorCpf && idsPorCpf.has(clienteId);
    return (nome || "").toLowerCase().includes(termo.toLowerCase());
  }

  const pendentes = fila.filter((b) => !b.encerrado_em);
  // "Histórico" é o que já foi encerrado hoje — não a fila inteira (que
  // vem da API com até 100 registros dos últimos dias, o que fazia a aba
  // acumular transbordos de dias anteriores em vez de mostrar só o dia).
  const historicoHoje = fila.filter((b) => b.encerrado_em && ehHoje(b.encerrado_em));
  const filaBase = filaTab === "pendentes" ? pendentes : historicoHoje;
  const filaFiltrada = filaBase
    .filter(
      (b) =>
        passaBusca(b.cliente_nome, b.cliente_id) &&
        (!filtros.estado || b.sessao_estado === filtros.estado) &&
        (!filtros.canal || b.canal === filtros.canal) &&
        (!filtros.tom || b.tom_emocional === filtros.tom)
    )
    // Clientes com prioridade (muitos chamados na semana) sobem para o topo
    // da fila, do que mais chamou para o que menos chamou. Os demais mantêm
    // a ordem original (sort é estável).
    .sort((a, z) => {
      const chamadosA = alertasPorCliente[a.cliente_id || ""]?.prioridade
        ? alertasPorCliente[a.cliente_id || ""].chamados_semana
        : 0;
      const chamadosZ = alertasPorCliente[z.cliente_id || ""]?.prioridade
        ? alertasPorCliente[z.cliente_id || ""].chamados_semana
        : 0;
      return chamadosZ - chamadosA;
    });

  const sessoesFiltradas = sessoes.filter(
    (s) =>
      passaBusca(s.cliente_nome, s.cliente_id) &&
      (!filtros.estado || s.estado === filtros.estado) &&
      (!filtros.canal || s.canal === filtros.canal) &&
      (!filtros.tom || tomDaSessao(s.ultima_intencao) === filtros.tom)
  );

  const set = (patch: Partial<FiltrosOperacao>) => setFiltros({ ...filtros, ...patch });

  return (
    <div className="space-y-4">
      {/* Barra de filtros */}
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[220px] text-xs text-gray-500">
            Buscar cliente (nome ou CPF)
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" strokeWidth={2} />
              <input
                value={filtros.busca}
                onChange={(e) => set({ busca: e.target.value })}
                placeholder="ex.: Carlos  ·  111.222.333-96"
                className="w-full rounded-lg border border-gray-300 py-1.5 pl-8 pr-3 text-sm text-gray-800 focus:border-claro-red focus:outline-none"
              />
            </div>
          </label>
          <FiltroSelect
            rotulo="Estado"
            valor={filtros.estado}
            opcoes={ESTADO_ORDEM.map((k) => ({ valor: k, rotulo: ESTADO_META[k]?.label || k }))}
            onChange={(v) => set({ estado: v })}
          />
          <FiltroSelect
            rotulo="Canal"
            valor={filtros.canal}
            opcoes={CANAL_ORDEM.map((k) => ({ valor: k, rotulo: CANAL_META[k]?.label || k }))}
            onChange={(v) => set({ canal: v })}
          />
          <FiltroSelect
            rotulo="Tom emocional"
            valor={filtros.tom}
            opcoes={TOM_ORDEM.map((k) => ({ valor: k, rotulo: TOM_META[k]?.label || k }))}
            onChange={(v) => set({ tom: v })}
          />
          {filtrosAtivos(filtros) && (
            <button
              onClick={() => setFiltros(FILTROS_VAZIOS)}
              className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:border-claro-red hover:text-claro-red"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              limpar filtros
            </button>
          )}
        </div>
        {buscaPorCpf && (
          <p className="mt-2 text-[11px] text-gray-400">
            {buscandoCpf
              ? "buscando pelo CPF…"
              : idsPorCpf && idsPorCpf.size > 0
              ? "filtrando pelo CPF informado"
              : "nenhum cliente encontrado com esse CPF"}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Fila de transbordo */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle icone={Headset}>Fila de transbordo (RF007-009)</SectionTitle>
            <div className="flex rounded-lg bg-gray-100 p-0.5 text-xs">
              <button
                onClick={() => setFilaTab("pendentes")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  filaTab === "pendentes" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"
                }`}
              >
                Pendentes ({pendentes.length})
              </button>
              <button
                onClick={() => setFilaTab("todos")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  filaTab === "todos" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"
                }`}
              >
                Histórico de hoje ({historicoHoje.length})
              </button>
            </div>
          </div>
          {filaFiltrada.length === 0 ? (
            <p className="text-sm text-gray-400">
              {filtrosAtivos(filtros)
                ? "Nenhum transbordo bate com os filtros."
                : filaTab === "pendentes"
                ? "Nenhum atendimento aguardando transbordo no momento."
                : "Nenhum transbordo encerrado hoje ainda."}
            </p>
          ) : (
            <div className="space-y-2">
              {filaFiltrada.map((b) => (
                <div key={b.id} className="vox-fade-in rounded-lg border border-gray-200 p-3 hover:border-claro-red">
                  <div className="flex items-center justify-between gap-2">
                    <NomeCliente
                      nome={b.cliente_nome}
                      clienteId={b.cliente_id}
                      onAbrir={onAbrirCliente}
                      className="text-sm"
                    />
                    <TomBadge tom={b.tom_emocional} />
                  </div>
                  {b.protocolo && <p className="mt-0.5 text-[11px] text-gray-400">protocolo {b.protocolo}</p>}
                  {b.possivel_fraude && (
                    <button
                      onClick={() => onAbrirFraude(b.cliente_nome)}
                      title="Ver alerta de fraude na aba Fraude"
                      className="mt-1.5 flex items-center gap-1 rounded-full bg-claro-red/10 px-2 py-0.5 text-[11px] font-medium text-claro-red hover:bg-claro-red hover:text-white"
                    >
                      <ShieldAlert className="h-3 w-3" strokeWidth={2.5} />
                      possível fraude
                    </button>
                  )}
                  <AlertasCliente alerta={b.cliente_id ? alertasPorCliente[b.cliente_id] : undefined} />
                  <button
                    onClick={() => onAbrirBriefing(b)}
                    className="mt-1 block w-full text-left text-xs text-gray-500 hover:text-gray-700"
                  >
                    <span className="line-clamp-2">{b.motivo_transbordo}</span>
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-claro-red">
                      ver briefing <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
                    </span>
                  </button>
                  <div className="mt-2 flex items-center justify-between">
                    <EstadoBadge estado={b.sessao_estado} resolvido={!!b.encerrado_em} />
                    <div className="flex items-center gap-1.5">
                      {b.atendente_id && <span className="text-[11px] text-gray-400">com {b.atendente_id}</span>}
                      {!b.encerrado_em && (
                        <button
                          onClick={() => onResponder(b)}
                          className="rounded bg-claro-red px-2 py-1 text-xs text-white hover:bg-claro-red-dark"
                        >
                          {b.atendente_id ? "Responder" : "Assumir e responder"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Sessões ativas */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle icone={Radio}>Sessões ativas (contexto persistente, RF001)</SectionTitle>
            <span className="text-[11px] text-gray-400">{sessoesFiltradas.length} de {sessoes.length}</span>
          </div>
          <div className="max-h-[28rem] space-y-2 overflow-y-auto">
            {sessoesFiltradas.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                <div className="min-w-0">
                  <NomeCliente nome={s.cliente_nome} clienteId={s.cliente_id} onAbrir={onAbrirCliente} className="text-sm" />
                  <span className="ml-2 text-xs text-gray-400">
                    via <CanalTag canal={s.canal} />
                  </span>
                  {s.protocolo && <span className="ml-2 text-[11px] text-gray-300">· {s.protocolo}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <EstadoBadge estado={s.estado} />
                  {s.estado === "EM_ATENDIMENTO_HUMANO" && (
                    <button
                      onClick={() =>
                        onAbrirChat({ id: s.id, clienteNome: s.cliente_nome, canal: s.canal || "whatsapp" })
                      }
                      className="rounded bg-claro-red px-2 py-0.5 text-[11px] text-white hover:bg-claro-red-dark"
                    >
                      Abrir chat
                    </button>
                  )}
                </div>
              </div>
            ))}
            {sessoesFiltradas.length === 0 && (
              <p className="text-sm text-gray-400">
                {filtrosAtivos(filtros)
                  ? "Nenhuma sessão bate com os filtros."
                  : 'Nenhuma sessão ativa. Inicie uma conversa na aba "Simulador".'}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// Alertas de comportamento do cliente, calculados a partir do histórico
// (tom das mensagens e transbordos na semana). Só renderiza o que se aplica.
function AlertasCliente({ alerta }: { alerta: ClienteAlerta | undefined }) {
  if (!alerta || (!alerta.hostil && !alerta.urgente && !alerta.prioridade)) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {alerta.prioridade && (
        <span className="rounded-full bg-claro-red/10 px-2 py-0.5 text-[11px] font-medium text-claro-red">
          já é a {alerta.chamados_semana}ª vez essa semana, priorize o atendimento
        </span>
      )}
      {alerta.hostil && (
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] text-red-700">
          tende a ter comportamento hostil
        </span>
      )}
      {alerta.urgente && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">
          tende a querer as coisas com urgência
        </span>
      )}
    </div>
  );
}

function FiltroSelect({
  rotulo,
  valor,
  opcoes,
  onChange,
}: {
  rotulo: string;
  valor: string | null;
  opcoes: { valor: string; rotulo: string }[];
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="text-xs text-gray-500">
      {rotulo}
      <select
        value={valor || ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-800 focus:border-claro-red focus:outline-none"
      >
        <option value="">Todos</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </label>
  );
}
