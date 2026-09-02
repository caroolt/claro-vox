import { useEffect, useState } from "react";
import { ChatSimulator } from "./components/ChatSimulator";
import { AgentPanel } from "./components/AgentPanel";
import { civ, orchestrator } from "./api";

type Aba = "cliente" | "atendente";

function App() {
  const [aba, setAba] = useState<Aba>("cliente");
  const [status, setStatus] = useState<{ civ: boolean; orch: boolean }>({ civ: false, orch: false });

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
      <header className="bg-claro-dark text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-claro-red font-bold text-xl">claro</span>
          <span className="text-gray-300 text-sm">| Vox — Camada de Identidade Conversacional</span>
        </div>
        <div className="flex items-center gap-4">
          <StatusDot ok={status.civ} label="CIV" />
          <StatusDot ok={status.orch} label="Orquestrador" />
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
        {aba === "cliente" ? <ChatSimulator /> : <AgentPanel />}
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
      <span className={`w-2 h-2 rounded-full ${ok ? "bg-green-400" : "bg-red-500"}`} />
      {label}
    </span>
  );
}

export default App;
