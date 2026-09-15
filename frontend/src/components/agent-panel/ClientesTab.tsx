import { useEffect, useState } from "react";
import { Search, Users } from "lucide-react";
import { civ } from "../../api";
import type { ClienteResumo } from "../../types";
import type { WsEvent } from "../../useBriefingSocket";
import { fmtData, fmtRelativo, pareceCpf } from "./meta";
import { SectionTitle, TipoClienteBadge } from "./ui";

export function ClientesTab({
  ultimoEvento,
  onAbrirCliente,
}: {
  ultimoEvento: WsEvent | null;
  onAbrirCliente: (id: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<ClienteResumo[]>([]);
  const [carregando, setCarregando] = useState(false);

  const termo = busca.trim();
  const porCpf = pareceCpf(termo);

  async function carregar() {
    setCarregando(true);
    try {
      const params = !termo ? {} : porCpf ? { cpf: termo } : { q: termo };
      setResultados(await civ.clientesBuscar(params));
    } catch {
      setResultados([]);
    } finally {
      setCarregando(false);
    }
  }

  // Busca com debounce ao digitar.
  useEffect(() => {
    const t = setTimeout(carregar, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termo]);

  // Recarrega quando algo muda em tempo real (nova sessão, novo cadastro).
  useEffect(() => {
    if (ultimoEvento) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultimoEvento]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <label className="text-xs text-gray-500">
          Buscar cliente por nome, telefone ou CPF completo
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" strokeWidth={2} />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="ex.: Carlos  ·  (11) 99999-0000  ·  111.222.333-96"
              className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm text-gray-800 focus:border-claro-red focus:outline-none"
            />
          </div>
        </label>
        <p className="mt-1.5 text-[11px] text-gray-400">
          {porCpf
            ? "busca por CPF: correspondência exata (o número não é armazenado, só o hash)"
            : termo
            ? "busca parcial por nome ou telefone"
            : "mostrando os clientes com interação mais recente"}
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
          <SectionTitle icone={Users}>{termo ? "Resultados" : "Clientes recentes"}</SectionTitle>
          <span className="text-[11px] text-gray-400">
            {carregando ? "buscando…" : `${resultados.length} cliente(s)`}
          </span>
        </div>

        {resultados.length === 0 && !carregando ? (
          <p className="px-4 py-6 text-sm text-gray-400">
            {termo ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado ainda."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {resultados.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onAbrirCliente(c.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-gray-800">{c.nome}</span>
                      <TipoClienteBadge tipo={c.tipo_cliente} />
                    </div>
                    <p className="mt-0.5 text-xs text-gray-400">
                      cliente desde {fmtData(c.data_cadastro)} · última interação {fmtRelativo(c.ultima_interacao)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-4 text-right">
                    <Stat valor={c.total_sessoes} rotulo="sessões" />
                    <Stat valor={c.total_transbordos} rotulo="transbordos" destaque={c.total_transbordos > 0} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ valor, rotulo, destaque }: { valor: number; rotulo: string; destaque?: boolean }) {
  return (
    <div>
      <p className={`text-lg font-bold tabular-nums ${destaque ? "text-claro-red" : "text-gray-800"}`}>{valor}</p>
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{rotulo}</p>
    </div>
  );
}
