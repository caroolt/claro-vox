import { useEffect, useState } from "react";
import { Save, Settings } from "lucide-react";
import { configuracoes } from "../../api";
import type { Configuracao } from "../../types";
import { SectionTitle } from "./ui";
import { fmtDataHora } from "./meta";

const ROTULOS: Record<string, string> = {
  meta_transbordo_pct: "Meta de transbordo (%)",
  limiar_fraude_pre_pago: "Limite de linhas pré-pagas por CPF (Regra A)",
  limiar_similaridade_estilo: "Similaridade mínima de estilo de escrita (Regra C)",
};

// Aba exclusiva do admin: parâmetros operacionais que hoje seriam
// constantes fixas no código (meta de transbordo da Visão geral, limiares
// do motor de detecção de fraude) — editáveis aqui, sem precisar de deploy.
export function ConfiguracoesTab() {
  const [lista, setLista] = useState<Configuracao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [salvandoChave, setSalvandoChave] = useState<string | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const dados = await configuracoes.listar();
      setLista(dados);
      setRascunho(Object.fromEntries(dados.map((c) => [c.chave, String(c.valor)])));
      setErro(null);
    } catch {
      setErro("Não foi possível carregar as configurações.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function salvar(chave: string) {
    const valor = Number(rascunho[chave]);
    if (!Number.isFinite(valor)) {
      setErro("Valor inválido.");
      return;
    }
    setSalvandoChave(chave);
    setErro(null);
    try {
      await configuracoes.atualizar(chave, valor);
      await carregar();
    } catch {
      setErro("Não foi possível salvar essa configuração.");
    } finally {
      setSalvandoChave(null);
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle icone={Settings}>Configurações</SectionTitle>
      </div>
      <p className="mb-4 text-xs text-gray-400">
        Parâmetros operacionais usados na Visão geral e no motor de detecção de fraude. Alterar aqui vale
        imediatamente, sem precisar de deploy.
      </p>

      {erro && <p className="mb-3 text-sm text-claro-red">{erro}</p>}
      {carregando ? (
        <p className="text-sm text-gray-400">Carregando…</p>
      ) : (
        <div className="space-y-3">
          {lista.map((c) => {
            const alterado = rascunho[c.chave] !== String(c.valor);
            return (
              <div
                key={c.chave}
                className="flex flex-col gap-2 rounded-lg border border-gray-100 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{ROTULOS[c.chave] || c.chave}</p>
                  {c.descricao && <p className="text-xs text-gray-400">{c.descricao}</p>}
                  {c.atualizado_em && (
                    <p className="mt-0.5 text-[11px] text-gray-300">
                      última alteração: {fmtDataHora(c.atualizado_em)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    type="number"
                    step="any"
                    value={rascunho[c.chave] ?? ""}
                    onChange={(e) => setRascunho((r) => ({ ...r, [c.chave]: e.target.value }))}
                    className="w-28 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-claro-red focus:outline-none"
                  />
                  <button
                    onClick={() => salvar(c.chave)}
                    disabled={!alterado || salvandoChave === c.chave}
                    className="flex items-center gap-1.5 rounded-lg bg-claro-red px-3 py-1.5 text-xs font-medium text-white hover:bg-claro-red-dark disabled:opacity-40"
                  >
                    <Save className="h-3.5 w-3.5" strokeWidth={2} />
                    {salvandoChave === c.chave ? "salvando…" : "salvar"}
                  </button>
                </div>
              </div>
            );
          })}
          {lista.length === 0 && <p className="text-sm text-gray-400">Nenhuma configuração encontrada.</p>}
        </div>
      )}
    </section>
  );
}
