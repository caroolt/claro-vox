import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { ChatSimulator } from "./components/ChatSimulator";
import { AgentPanel } from "./components/agent-panel/AgentPanel";
import { LoginScreen } from "./components/auth/LoginScreen";
import { civ, onAuthExpirado, orchestrator, setAuthToken } from "./api";
import type { Usuario } from "./types";
import logoClaroVox from "./assets/claro-vox-logo.png";

// Duas páginas independentes: o simulador de chat do cliente em "/" e o
// painel do atendente em "/painel". O roteamento é só por pathname — o
// Cloudflare (wrangler.jsonc) e o nginx (nginx.conf) devolvem o index.html
// para qualquer rota, então "/painel" pode ser aberto direto em outra aba.
type Pagina = "chat" | "painel";

const ROTA_PAINEL = "/painel";

function paginaAtual(): Pagina {
  return window.location.pathname.replace(/\/+$/, "") === ROTA_PAINEL ? "painel" : "chat";
}

const STORAGE_TOKEN = "vox_briefing_token";
const STORAGE_USUARIO = "vox_briefing_usuario";

function App() {
  const [pagina, setPagina] = useState<Pagina>(paginaAtual);
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
    const aoNavegar = () => setPagina(paginaAtual());
    window.addEventListener("popstate", aoNavegar);
    return () => window.removeEventListener("popstate", aoNavegar);
  }, []);

  function navegar(destino: Pagina) {
    window.history.pushState(null, "", destino === "painel" ? ROTA_PAINEL : "/");
    setPagina(destino);
  }

  useEffect(() => {
    document.title = pagina === "painel" ? "Claro Vox · Painel do Atendente" : "Claro Vox · Simulador de Cliente";
  }, [pagina]);

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
    <div className="flex h-dvh flex-col bg-gray-100">
      <header className="flex items-center justify-between gap-3 bg-claro-black px-4 py-3 text-white">
        <div className="flex min-w-0 items-center gap-3">
          <img src={logoClaroVox} alt="Claro Vox" className="h-6 w-auto" />
          <span className="hidden text-sm text-gray-400 sm:inline">
            | {pagina === "painel" ? "Painel do Atendente (Vox Briefing)" : "Simulador de Cliente"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          <StatusDot ok={status.civ} label="CIV" />
          <StatusDot ok={status.orch} label="Orquestrador" />
          {usuario && pagina === "painel" && (
            <button onClick={sair} className="hidden text-xs text-gray-300 hover:text-white md:inline">
              {usuario.nome} · sair
            </button>
          )}
          <a
            href={pagina === "painel" ? "/" : ROTA_PAINEL}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navegar(pagina === "painel" ? "chat" : "painel");
            }}
            className="flex items-center gap-1 text-xs text-gray-300 hover:text-white"
          >
            {pagina === "painel" ? "Simulador" : "Painel"}
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
          </a>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {pagina === "chat" ? (
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

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-300" title={label}>
      <span className={`w-2 h-2 rounded-full ${ok ? "bg-status-good" : "bg-status-critical"}`} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

export default App;
