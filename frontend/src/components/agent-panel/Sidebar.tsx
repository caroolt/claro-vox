import {
  BookOpen,
  Headset,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldAlert,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import logoClaroVox from "../../assets/claro-vox-logo.png";
import type { Usuario } from "../../types";
import type { Aba } from "./AgentPanel";

const ICONE_POR_ABA: Record<Aba, LucideIcon> = {
  geral: LayoutDashboard,
  operacao: Headset,
  clientes: Users,
  kb: BookOpen,
  atendentes: UserCog,
  fraude: ShieldAlert,
  configuracoes: Settings,
};

export function Sidebar({
  abas,
  abaAtiva,
  onSelecionar,
  pendentes,
  usuario,
  onSair,
}: {
  abas: { id: Aba; rotulo: string }[];
  abaAtiva: Aba;
  onSelecionar: (a: Aba) => void;
  pendentes: number;
  usuario: Usuario;
  onSair: () => void;
}) {
  const iniciais = usuario.nome
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col bg-claro-black text-white">
      <div className="flex items-center gap-2 px-4 py-4">
        <img src={logoClaroVox} alt="Claro Vox" className="h-5 w-auto" />
      </div>
      <p className="px-4 pb-3 text-[10px] font-medium uppercase tracking-wider text-white/35">Vox Briefing</p>

      <nav className="flex-1 space-y-0.5 px-2.5">
        {abas.map((a) => {
          const Icone = ICONE_POR_ABA[a.id];
          const ativo = a.id === abaAtiva;
          return (
            <button
              key={a.id}
              onClick={() => onSelecionar(a.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                ativo ? "bg-claro-red text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icone className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="flex-1 text-left">{a.rotulo}</span>
              {a.id === "operacao" && pendentes > 0 && (
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${
                    ativo ? "bg-white text-claro-red" : "bg-claro-red text-white"
                  }`}
                >
                  {pendentes}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-1 py-1.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">
            {iniciais}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-white">{usuario.nome}</p>
            <p className="text-[10px] uppercase tracking-wide text-white/40">{usuario.role}</p>
          </div>
          <button
            onClick={onSair}
            title="Sair"
            className="rounded-md p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>
    </aside>
  );
}
