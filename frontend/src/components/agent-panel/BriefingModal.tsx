import { CheckCircle2, FileText, Hash, Lightbulb, MessageSquareText, Radio, X } from "lucide-react";
import type { Briefing } from "../../types";
import { CANAL_META } from "./meta";
import { TomBadge } from "./ui";

// Modal com o briefing de transbordo: o "dossiê" que o Orquestrador monta
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between bg-claro-black px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
              <FileText className="h-4 w-4 text-claro-red" strokeWidth={2} />
            </span>
            <div>
              <h3 className="font-semibold">Briefing de transbordo</h3>
              <p className="text-xs text-white/50">{briefing.cliente_nome || "Cliente não identificado"}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white">
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <TomBadge tom={briefing.tom_emocional} />
            {briefing.protocolo && (
              <span className="flex items-center gap-1 rounded-full bg-claro-gray-light px-2.5 py-1 text-[11px] font-medium text-gray-600">
                <Hash className="h-3 w-3" strokeWidth={2.5} />
                {briefing.protocolo}
              </span>
            )}
            {briefing.canais_utilizados && (
              <span className="flex items-center gap-1 rounded-full bg-claro-gray-light px-2.5 py-1 text-[11px] font-medium text-gray-600">
                <Radio className="h-3 w-3" strokeWidth={2.5} />
                {briefing.canais_utilizados
                  .split(",")
                  .map((c) => CANAL_META[c.trim()]?.label || c.trim())
                  .join(", ")}
              </span>
            )}
          </div>

          <CampoBriefing rotulo="Motivo" valor={briefing.motivo_transbordo} destaque />
          <CampoBriefing rotulo="Resumo da jornada" valor={briefing.resumo_jornada} icone={MessageSquareText} />
          <CampoBriefing rotulo="Sugestão de resolução" valor={briefing.sugestao_resolucao} icone={Lightbulb} />
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 bg-claro-gray-light px-5 py-3">
          {!briefing.encerrado_em && (
            <>
              <button
                onClick={() => onEncerrar(briefing.id)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:border-gray-400"
              >
                Encerrar sessão
              </button>
              <button
                onClick={() => onResponder(briefing)}
                className="flex items-center gap-1.5 rounded-lg bg-claro-red px-3 py-1.5 text-sm font-medium text-white hover:bg-claro-red-dark"
              >
                <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                {briefing.atendente_id ? "Responder" : "Assumir e responder"}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function CampoBriefing({
  rotulo,
  valor,
  destaque,
  icone: Icone,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
  icone?: typeof Lightbulb;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        destaque ? "border-claro-red/20 bg-claro-red-light" : "border-gray-200 bg-claro-gray-light"
      }`}
    >
      <p
        className={`mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${
          destaque ? "text-claro-red-dark" : "text-gray-400"
        }`}
      >
        {Icone && <Icone className="h-3.5 w-3.5" strokeWidth={2} />}
        {rotulo}
      </p>
      <p className={`text-sm ${destaque ? "text-gray-800" : "text-gray-700"}`}>{valor}</p>
    </div>
  );
}
