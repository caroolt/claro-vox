import { useEffect, useState } from "react";
import { KeyRound, Pencil, Power, Trash2, UserPlus, Users } from "lucide-react";
import { usuarios } from "../../api";
import type { UsuarioAdmin, Role } from "../../types";
import { SectionTitle } from "./ui";

// Aba exclusiva do admin: CRUD normal dos atendentes (e outros admins) do
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
        <SectionTitle icone={Users}>Atendentes</SectionTitle>
        <button
          onClick={() => setEditando("novo")}
          className="flex items-center gap-1.5 rounded-lg bg-claro-red px-3 py-1.5 text-xs font-medium text-white hover:bg-claro-red-dark"
        >
          <UserPlus className="h-3.5 w-3.5" strokeWidth={2} />
          Novo atendente
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
            <tbody className="divide-y divide-gray-100">
              {lista.map((u) => (
                <tr key={u.id} className="hover:bg-claro-gray-light/60">
                  <td className="py-2.5 font-medium text-gray-800">{u.nome}</td>
                  <td className="py-2.5 text-gray-500">{u.email}</td>
                  <td className="py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        u.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        u.ativo ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {u.ativo ? "ativo" : "inativo"}
                    </span>
                  </td>
                  <td className="py-2.5 text-[11px] text-gray-400">{u.mfa_ativado ? "configurado" : "pendente"}</td>
                  <td className="py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <BotaoAcao onClick={() => setEditando(u)} titulo="Editar" icone={Pencil} />
                      <BotaoAcao onClick={() => resetarMfa(u)} titulo="Resetar MFA" icone={KeyRound} />
                      <BotaoAcao
                        onClick={() => alternarAtivo(u)}
                        titulo={u.ativo ? "Desativar" : "Ativar"}
                        icone={Power}
                      />
                      {u.id !== usuarioLogadoId && (
                        <BotaoAcao onClick={() => excluir(u)} titulo="Excluir" icone={Trash2} perigo />
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

function BotaoAcao({
  onClick,
  titulo,
  icone: Icone,
  perigo,
}: {
  onClick: () => void;
  titulo: string;
  icone: typeof Pencil;
  perigo?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className={`rounded-lg border border-gray-200 p-1.5 transition ${
        perigo ? "text-claro-red hover:border-claro-red hover:bg-claro-red-light" : "text-gray-500 hover:border-claro-red hover:text-claro-red"
      }`}
    >
      <Icone className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onFechar}>
      <form
        onSubmit={salvar}
        className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 bg-claro-black px-5 py-4 text-white">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
            <UserPlus className="h-4 w-4 text-claro-red" strokeWidth={2} />
          </span>
          <h3 className="font-semibold">{usuario ? "Editar atendente" : "Novo atendente"}</h3>
        </div>
        <div className="space-y-3 p-5">
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
        <div className="flex justify-end gap-2 border-t border-gray-100 bg-claro-gray-light px-5 py-3">
          <button type="button" onClick={onFechar} className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">
            cancelar
          </button>
          <button type="submit" disabled={salvando} className="rounded-lg bg-claro-red px-3 py-1.5 text-sm font-medium text-white hover:bg-claro-red-dark disabled:opacity-50">
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
