import { useEffect, useState } from "react";
import { civ } from "../../api";
import type { ClienteDetalhe } from "../../types";
import type { WsEvent } from "../../useBriefingSocket";
import { StackedBar, STATUS_HEX } from "../charts";
import { CANAL_META, fmtData, fmtDataHora, montarSegmentos, TOM_META, TOM_ORDEM } from "./meta";
import { EstadoBadge, Row, TipoClienteBadge, TomBadge } from "./ui";
import { exportarConversaPdf } from "./exportar";

export function ClienteDrawer({
  clienteId,
  ultimoEvento,
  onClose,
  onAbrirChat,
  onExcluido,
}: {
  clienteId: string;
  ultimoEvento: WsEvent | null;
  onClose: () => void;
  onAbrirChat: (s: { id: string; clienteNome: string | null; canal: string }) => void;
  onExcluido: () => void;
}) {
  const [dados, setDados] = useState<ClienteDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [briefingAberto, setBriefingAberto] = useState<string | null>(null);
  const [pdfSessao, setPdfSessao] = useState<string | null>(null);

  async function exportarPdf(sessaoId: string) {
    setPdfSessao(sessaoId);
    try {
      await exportarConversaPdf(sessaoId);
    } finally {
      setPdfSessao(null);
    }
  }

  async function carregar() {
    try {
      setDados(await civ.clienteDetalhe(clienteId));
      setErro(null);
    } catch (e: any) {
      setErro(e.message || "falha ao carregar");
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId]);

  useEffect(() => {
    if (ultimoEvento) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultimoEvento]);

  async function excluir() {
    if (!confirm("Confirma a exclusão dos dados deste cliente (LGPD art. 18)? Esta ação é irreversível.")) return;
    await civ.excluirCliente(clienteId);
    onExcluido();
    onClose();
  }

  const c = dados?.cliente;
  const acess = dados?.acessibilidade;
  const prefs = acess
    ? [
        acess.modalidade_libras && "Libras",
        acess.leitor_de_tela && "Leitor de tela",
        acess.linguagem_simplificada && "Linguagem simplificada",
      ].filter(Boolean)
    : [];

  const segmentosTom = dados
    ? montarSegmentos(dados.tom_emocional, TOM_META, TOM_ORDEM, (_k, m) => STATUS_HEX[m?.status || "neutral"])
    : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="vox-slide-in flex h-full w-full max-w-md flex-col bg-claro-gray-light shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-200 bg-white px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900">{c?.nome || "Cliente"}</h3>
              <TipoClienteBadge tipo={c?.tipo_cliente} />
            </div>
            {c && (
              <p className="text-[11px] text-gray-400">
                cliente desde {fmtData(c.data_cadastro)} · última interação {fmtDataHora(dados?.resumo.ultima_interacao)}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {erro && <p className="text-sm text-status-critical">Erro ao carregar: {erro}</p>}
          {!dados && !erro && <p className="text-sm text-gray-400">Carregando…</p>}

          {dados && (
            <>
              {/* Stats rápidas */}
              <div className="grid grid-cols-3 gap-2">
                <MiniStat valor={dados.resumo.total_sessoes} rotulo="sessões" />
                <MiniStat
                  valor={dados.resumo.total_transbordos}
                  rotulo="transbordos"
                  destaque={dados.resumo.total_transbordos > 0}
                />
                <MiniStat valor={dados.resumo.total_mensagens} rotulo="mensagens" />
              </div>

              {/* Identificação */}
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Identificação</h4>
                <dl className="space-y-2 text-sm">
                  <Row label="CPF" value={c!.tem_cpf ? "cadastrado (armazenado como hash)" : "não informado"} />
                  {c!.telefone && <Row label="Telefone" value={c!.telefone} />}
                  <Row
                    label="Consentimento"
                    value={
                      c!.consentimento_ts
                        ? `${c!.consentimento_versao || "—"} · ${fmtData(c!.consentimento_ts)}`
                        : "não registrado"
                    }
                  />
                </dl>
              </section>

              {/* Acessibilidade */}
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Preferências de acessibilidade
                </h4>
                {prefs.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {prefs.map((p) => (
                      <span key={p as string} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                        {p}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">Nenhuma preferência registrada.</p>
                )}
              </section>

              {/* NPS dado pelo cliente */}
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  NPS dado por este cliente
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <NpsBloco titulo="Assistente virtual" dado={dados.nps.ia} />
                  <NpsBloco titulo="Atendente" dado={dados.nps.atendente} />
                </div>
              </section>

              {/* Tom emocional */}
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Tom emocional (histórico)
                </h4>
                <StackedBar segments={segmentosTom} emptyLabel="Nenhuma mensagem classificada" />
              </section>

              {/* Sessões */}
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Sessões ({dados.sessoes.length})
                </h4>
                <div className="space-y-2">
                  {dados.sessoes.map((s) => (
                    <div key={s.id} className="rounded-lg border border-gray-100 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">
                          {CANAL_META[s.canal || ""]?.icone} {CANAL_META[s.canal || ""]?.label || s.canal || "?"}
                        </span>
                        <EstadoBadge estado={s.estado} />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-gray-400">
                          {fmtDataHora(s.criado_em)} → {fmtDataHora(s.atualizado_em)}
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            onClick={() => exportarPdf(s.id)}
                            disabled={pdfSessao === s.id}
                            className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-500 hover:border-claro-red hover:text-claro-red disabled:opacity-50"
                          >
                            {pdfSessao === s.id ? "gerando…" : "PDF"}
                          </button>
                          {s.estado === "EM_ATENDIMENTO_HUMANO" && (
                            <button
                              onClick={() =>
                                onAbrirChat({ id: s.id, clienteNome: c!.nome, canal: s.canal || "whatsapp" })
                              }
                              className="rounded bg-claro-red px-2 py-0.5 text-[11px] text-white hover:bg-claro-red-dark"
                            >
                              Abrir chat
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {dados.sessoes.length === 0 && <p className="text-sm text-gray-400">Sem sessões.</p>}
                </div>
              </section>

              {/* Transbordos */}
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Transbordos ({dados.briefings.length})
                </h4>
                <div className="space-y-2">
                  {dados.briefings.map((b) => {
                    const aberto = briefingAberto === b.id;
                    return (
                      <div key={b.id} className="rounded-lg border border-gray-100 p-3">
                        <button
                          onClick={() => setBriefingAberto(aberto ? null : b.id)}
                          className="flex w-full items-center justify-between gap-2 text-left"
                        >
                          <span className="line-clamp-1 text-xs text-gray-600">{b.motivo_transbordo}</span>
                          <TomBadge tom={b.tom_emocional} />
                        </button>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                          <span>{fmtDataHora(b.gerado_em)}</span>
                          <span>{b.encerrado_em ? "resolvido" : b.atendente_id ? `com ${b.atendente_id}` : "pendente"}</span>
                        </div>
                        {aberto && (
                          <dl className="mt-2 space-y-1.5 border-t border-gray-100 pt-2 text-xs">
                            <Row label="Resumo da jornada" value={b.resumo_jornada} />
                            <Row label="Sugestão de resolução" value={b.sugestao_resolucao} />
                            <Row label="Canais" value={b.canais_utilizados} />
                          </dl>
                        )}
                      </div>
                    );
                  })}
                  {dados.briefings.length === 0 && <p className="text-sm text-gray-400">Nenhum transbordo.</p>}
                </div>
              </section>
            </>
          )}
        </div>

        {dados && (
          <div className="border-t border-gray-200 bg-white px-4 py-3">
            <button
              onClick={excluir}
              className="text-xs text-gray-400 underline hover:text-claro-red"
            >
              Excluir dados deste cliente (LGPD art. 18)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ valor, rotulo, destaque }: { valor: number; rotulo: string; destaque?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
      <p className={`text-2xl font-bold tabular-nums ${destaque ? "text-claro-red" : "text-gray-900"}`}>{valor}</p>
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{rotulo}</p>
    </div>
  );
}

function NpsBloco({
  titulo,
  dado,
}: {
  titulo: string;
  dado: { nota: number; comentario: string | null; criado_em: string } | null;
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-2.5">
      <p className="text-[11px] text-gray-500">{titulo}</p>
      {dado ? (
        <>
          <p className="text-xl font-bold tabular-nums text-gray-900">
            {dado.nota}
            <span className="text-xs font-normal text-gray-300"> / 10</span>
          </p>
          {dado.comentario && <p className="mt-0.5 text-[11px] italic text-gray-500">“{dado.comentario}”</p>}
        </>
      ) : (
        <p className="text-sm text-gray-300">sem avaliação</p>
      )}
    </div>
  );
}
