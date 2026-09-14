import { useEffect, useState } from "react";
import { ChatSimulator } from "./components/ChatSimulator";
import { AgentPanel } from "./components/agent-panel/AgentPanel";
import { LoginScreen } from "./components/auth/LoginScreen";
import { civ, onAuthExpirado, orchestrator, setAuthToken } from "./api";
import type { Usuario } from "./types";
import logoClaroVox from "./assets/claro-vox-logo.png";

type Aba = "cliente" | "atendente";

const STORAGE_TOKEN = "vox_briefing_token";
const STORAGE_USUARIO = "vox_briefing_usuario";

function App() {
  const [aba, setAba] = useState<Aba>("cliente");
  const [status, setStatus] = useState<{ civ: boolean; orch: boolean }>({ civ: false, orch: false });
  const [usuario, setUsuario] = useState<Usuario | null>(null);

  // Restaura a sessão do painel (se houver) ao carregar a página, e derruba
  // o usuário de volta ao login sempre que uma chamada autenticada voltar 401.
  useEffect(() => {
    const token = localStorage.getItem(STORAGE_TOKEN);
    const usuarioSalvo = localStorage.getItem(STORAGE_USUARIO);
    if (token && usuarioSalvo) {
      setAuthToken(token);
      setUsuario(JSON.parse(usuarioSalvo));
    }
    onAuthExpirado(() => sair());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function entrar(token: string, u: Usuario) {
    setAuthToken(token);
    localStorage.setItem(STORAGE_TOKEN, token);
    localStorage.setItem(STORAGE_USUARIO, JSON.stringify(u));
    setUsuario(u);
  }

  function sair() {
    setAuthToken(null);
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USUARIO);
    setUsuario(null);
  }

  useEffect(() => {
    const checar = async () => {
      const civOk = await civ.health().then(() => true).catch(() => false);
      const orchOk = await orchestrator.health().then(() => true).catch(() => false);
      setStatus({ civ: civOk, orch: orchOk });
    };
    checar();
    const id = setInterval(checar, 10000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      <header className="bg-claro-black text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={logoClaroVox} alt="Claro Vox" className="h-6 w-auto" />
          <span className="text-gray-400 text-sm hidden sm:inline">| Camada de Identidade Conversacional</span>
        </div>
        <div className="flex items-center gap-4">
          <StatusDot ok={status.civ} label="CIV" />
          <StatusDot ok={status.orch} label="Orquestrador" />
          {usuario && aba === "atendente" && (
            <button onClick={sair} className="text-xs text-gray-300 hover:text-white">
              {usuario.nome} · sair
            </button>
          )}
        </div>
      </header>

      <nav className="bg-white border-b border-gray-200 px-4 flex gap-1">
        <TabButton ativo={aba === "cliente"} onClick={() => setAba("cliente")}>
          Simulador de Cliente
        </TabButton>
        <TabButton ativo={aba === "atendente"} onClick={() => setAba("atendente")}>
          Painel do Atendente (Vox Briefing)
        </TabButton>
      </nav>

      <main className="flex-1 overflow-hidden">
        {aba === "cliente" ? (
          <ChatSimulator />
        ) : usuario ? (
          <AgentPanel usuario={usuario} onSair={sair} />
        ) : (
          <LoginScreen onEntrar={entrar} />
        )}
      </main>
    </div>
  );
}

function TabButton({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
        ativo ? "border-claro-red text-claro-red" : "border-transparent text-gray-500 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-300">
      <span className={`w-2 h-2 rounded-full ${ok ? "bg-status-good" : "bg-status-critical"}`} />
      {label}
    </span>
  );
}

export default App;
