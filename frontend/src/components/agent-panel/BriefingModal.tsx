import type { Briefing } from "../../types";
import { TOM_META } from "./meta";
import { Row } from "./ui";

// Modal com o briefing de transbordo — o "dossiê" que o Orquestrador monta
// para o atendente assumir a conversa sem o cliente repetir nada (RF007-009).
export function BriefingModal({
  briefing,
  onResponder,
  onEncerrar,
  onClose,
}: {
  briefing: Briefing;
  onResponder: (b: Briefing) => void;
  onEncerrar: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="mx-4 w-full max-w-lg rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 font-semibold text-gray-800">Briefing de transbordo</h3>
        <p className="mb-3 text-sm text-gray-500">{briefing.cliente_nome}</p>
        <dl className="space-y-2 text-sm">
          {briefing.protocolo && <Row label="Protocolo" value={briefing.protocolo} />}
          <Row label="Motivo" value={briefing.motivo_transbordo} />
          <Row label="Tom emocional" value={TOM_META[briefing.tom_emocional]?.label || briefing.tom_emocional} />
          <Row label="Canais utilizados" value={briefing.canais_utilizados} />
          <Row label="Resumo da jornada" value={briefing.resumo_jornada} />
          <Row label="Sugestão de resolução" value={briefing.sugestao_resolucao} />
        </dl>
        <div className="mt-4 flex justify-end gap-2">
          {!briefing.encerrado_em && (
            <>
              <button
                onClick={() => onResponder(briefing)}
                className="rounded bg-claro-red px-3 py-1.5 text-sm text-white hover:bg-claro-red-dark"
              >
                {briefing.atendente_id ? "Responder" : "Assumir e responder"}
              </button>
              <button
                onClick={() => onEncerrar(briefing.id)}
                className="rounded bg-gray-700 px-3 py-1.5 text-sm text-white"
              >
                Encerrar sessão
              </button>
            </>
          )}
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
