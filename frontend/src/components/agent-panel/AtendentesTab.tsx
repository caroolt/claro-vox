import { useEffect, useState } from "react";
import { usuarios } from "../../api";
import type { UsuarioAdmin, Role } from "../../types";

// Aba exclusiva do admin — CRUD normal dos atendentes (e outros admins) do
// Painel do Atendente / Vox Briefing (RBAC).
export function AtendentesTab({ usuarioLogadoId }: { usuarioLogadoId: string }) {
  const [lista, setLista] = useState<UsuarioAdmin[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<UsuarioAdmin | "novo" | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      setLista(await usuarios.listar());
      setErro(null);
    } catch {
      setErro("Não foi possível carregar os atendentes.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function excluir(u: UsuarioAdmin) {
    if (!confirm(`Excluir "${u.nome}"? Essa ação não pode ser desfeita.`)) return;
    await usuarios.excluir(u.id);
    await carregar();
  }

  async function alternarAtivo(u: UsuarioAdmin) {
    await usuarios.atualizar(u.id, { ativo: !u.ativo });
    await carregar();
  }

  async function resetarMfa(u: UsuarioAdmin) {
    if (!confirm(`Resetar o MFA de "${u.nome}"? No próximo login, ele(a) vai configurar o app autenticador de novo.`)) return;
    await usuarios.atualizar(u.id, { resetar_mfa: true });
    await carregar();
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium text-gray-700">Atendentes</h3>
        <button
          onClick={() => setEditando("novo")}
          className="rounded-lg bg-claro-red px-3 py-1.5 text-xs font-medium text-white hover:bg-claro-red-dark"
        >
          + Novo atendente
        </button>
      </div>

      {erro && <p className="mb-3 text-sm text-claro-red">{erro}</p>}
      {carregando ? (
        <p className="text-sm text-gray-400">Carregando…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-gray-400">
                <th className="pb-2">Nome</th>
                <th className="pb-2">E-mail</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">MFA</th>
                <th className="pb-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((u) => (
                <tr key={u.id} className="border-t border-gray-100">
                  <td className="py-2 font-medium text-gray-800">{u.nome}</td>
                  <td className="py-2 text-gray-500">{u.email}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        u.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        u.ativo ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {u.ativo ? "ativo" : "inativo"}
                    </span>
                  </td>
                  <td className="py-2 text-[11px] text-gray-400">{u.mfa_ativado ? "configurado" : "pendente"}</td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setEditando(u)} className="rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:border-claro-red hover:text-claro-red">
                        editar
                      </button>
                      <button onClick={() => resetarMfa(u)} className="rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:border-claro-red hover:text-claro-red">
                        resetar MFA
                      </button>
                      <button onClick={() => alternarAtivo(u)} className="rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:border-claro-red hover:text-claro-red">
                        {u.ativo ? "desativar" : "ativar"}
                      </button>
                      {u.id !== usuarioLogadoId && (
                        <button onClick={() => excluir(u)} className="rounded border border-gray-200 px-2 py-1 text-[11px] text-claro-red hover:border-claro-red">
                          excluir
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-sm text-gray-400">
                    Nenhum atendente cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <FormularioUsuario
          usuario={editando === "novo" ? null : editando}
          onFechar={() => setEditando(null)}
          onSalvo={async () => {
            setEditando(null);
            await carregar();
          }}
        />
      )}
    </section>
  );
}

function FormularioUsuario({
  usuario,
  onFechar,
  onSalvo,
}: {
  usuario: UsuarioAdmin | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [nome, setNome] = useState(usuario?.nome || "");
  const [email, setEmail] = useState(usuario?.email || "");
  const [senha, setSenha] = useState("");
  const [role, setRole] = useState<Role>(usuario?.role || "atendente");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      if (usuario) {
        await usuarios.atualizar(usuario.id, { nome, email, role, ...(senha ? { senha } : {}) });
      } else {
        if (senha.length < 8) throw new Error("senha curta");
        await usuarios.criar({ nome, email, senha, role });
      }
      onSalvo();
    } catch (e) {
      setErro(
        String(e).includes("409")
          ? "Já existe um usuário com esse e-mail."
          : "Não foi possível salvar. Confira os campos (senha com 8+ caracteres)."
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onFechar}>
      <form
        onSubmit={salvar}
        className="mx-4 w-full max-w-sm rounded-xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 font-semibold text-gray-800">{usuario ? "Editar atendente" : "Novo atendente"}</h3>
        <div className="space-y-3">
          <Campo label="Nome">
            <input required value={nome} onChange={(e) => setNome(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-claro-red focus:outline-none" />
          </Campo>
          <Campo label="E-mail">
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-claro-red focus:outline-none" />
          </Campo>
          <Campo label={usuario ? "Nova senha (opcional)" : "Senha"}>
            <input
              type="password"
              required={!usuario}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder={usuario ? "deixe em branco para manter" : undefined}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-claro-red focus:outline-none"
            />
          </Campo>
          <Campo label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-claro-red focus:outline-none">
              <option value="atendente">Atendente</option>
              <option value="admin">Admin</option>
            </select>
          </Campo>
          {erro && <p className="text-xs text-claro-red">{erro}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onFechar} className="rounded px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">
            cancelar
          </button>
          <button type="submit" disabled={salvando} className="rounded bg-claro-red px-3 py-1.5 text-sm text-white hover:bg-claro-red-dark disabled:opacity-50">
            {salvando ? "salvando…" : "salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}
