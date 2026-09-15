import { useState } from "react";
import { KeyRound, LockKeyhole, ScanLine, ShieldCheck } from "lucide-react";
import { auth } from "../../api";
import type { Usuario } from "../../types";
import logoClaroVox from "../../assets/claro-vox-logo.png";

type Etapa = "credenciais" | "mfa" | "mfa_configuracao";

const DESTAQUES = [
  { icone: LockKeyhole, texto: "Login com senha + verificação em duas etapas (MFA)" },
  { icone: ShieldCheck, texto: "Acesso por perfil — admin ou atendente" },
  { icone: ScanLine, texto: "Cada sessão tem um protocolo próprio, rastreável de ponta a ponta" },
];

export function LoginScreen({ onEntrar }: { onEntrar: (token: string, usuario: Usuario) => void }) {
  const [etapa, setEtapa] = useState<Etapa>("credenciais");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [loginToken, setLoginToken] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function enviarCredenciais(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const resp = await auth.login(email.trim(), senha);
      setLoginToken(resp.login_token);
      if (resp.etapa === "mfa_configuracao") {
        setQrDataUrl(resp.mfa_qr_data_url || "");
        setMfaSecret(resp.mfa_secret || "");
        setEtapa("mfa_configuracao");
      } else {
        setEtapa("mfa");
      }
    } catch {
      setErro("E-mail ou senha inválidos.");
    } finally {
      setCarregando(false);
    }
  }

  async function confirmarCodigo(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const resp = await auth.mfaVerificar(loginToken, codigo.trim());
      onEntrar(resp.token, resp.usuario);
    } catch {
      setErro("Código MFA inválido ou expirado.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex h-full bg-claro-gray-light">
      {/* Painel de marca — some em telas estreitas */}
      <div className="relative hidden w-[38%] shrink-0 flex-col justify-between overflow-hidden bg-claro-black px-10 py-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-claro-red/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-claro-red/10 blur-3xl"
          aria-hidden
        />

        <img src={logoClaroVox} alt="Claro Vox" className="relative h-6 w-auto self-start" />

        <div className="relative">
          <h1 className="mb-3 text-2xl font-bold leading-snug">
            Painel do Atendente
            <br />
            Vox Briefing
          </h1>
          <p className="mb-8 max-w-xs text-sm text-white/50">
            Acesso restrito à operação — fila de transbordo, histórico de clientes e base de conhecimento em tempo
            real.
          </p>
          <ul className="space-y-4">
            {DESTAQUES.map((d) => (
              <li key={d.texto} className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <d.icone className="h-4 w-4 text-claro-red" strokeWidth={2} />
                </span>
                <span className="pt-1.5 text-xs text-white/70">{d.texto}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] text-white/30">Claro Vox — Camada de Identidade Conversacional</p>
      </div>

      {/* Formulário */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-center lg:hidden">
            <img src={logoClaroVox} alt="Claro Vox" className="h-7 w-auto" />
          </div>

          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900">
              {etapa === "credenciais" ? "Entrar" : "Verificação em duas etapas"}
            </h2>
            <p className="mt-1 text-sm text-gray-400">
              {etapa === "credenciais"
                ? "Use suas credenciais do Vox Briefing."
                : "Confirme sua identidade com o app autenticador."}
            </p>
          </div>

          {etapa === "credenciais" && (
            <form onSubmit={enviarCredenciais} className="space-y-4">
              <Campo label="E-mail">
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-claro-red focus:outline-none focus:ring-1 focus:ring-claro-red"
                  placeholder="voce@clarovox.com"
                />
              </Campo>
              <Campo label="Senha">
                <input
                  type="password"
                  required
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-claro-red focus:outline-none focus:ring-1 focus:ring-claro-red"
                />
              </Campo>
              {erro && <MensagemErro>{erro}</MensagemErro>}
              <Botao carregando={carregando}>Entrar</Botao>
            </form>
          )}

          {etapa === "mfa_configuracao" && (
            <form onSubmit={confirmarCodigo} className="space-y-4">
              <p className="rounded-lg bg-claro-gray-light px-3 py-2.5 text-xs text-gray-500">
                Primeiro acesso — escaneie este QR code em um app autenticador (Google Authenticator, Authy, etc.) e
                depois digite o código de 6 dígitos gerado.
              </p>
              <div className="flex justify-center">
                {qrDataUrl && (
                  <img
                    src={qrDataUrl}
                    alt="QR code de configuração do MFA"
                    className="h-[172px] w-[172px] rounded-lg border border-gray-200 p-1"
                  />
                )}
              </div>
              {mfaSecret && (
                <p className="break-all rounded-lg bg-gray-50 p-2 text-center text-[11px] text-gray-500">
                  Não consegue escanear? Chave manual: <span className="font-mono">{mfaSecret}</span>
                </p>
              )}
              <CampoCodigo codigo={codigo} setCodigo={setCodigo} />
              {erro && <MensagemErro>{erro}</MensagemErro>}
              <Botao carregando={carregando}>Ativar MFA e entrar</Botao>
            </form>
          )}

          {etapa === "mfa" && (
            <form onSubmit={confirmarCodigo} className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg bg-claro-gray-light px-3 py-2.5 text-xs text-gray-500">
                <KeyRound className="h-4 w-4 shrink-0 text-gray-400" strokeWidth={2} />
                Digite o código de 6 dígitos do seu app autenticador.
              </div>
              <CampoCodigo codigo={codigo} setCodigo={setCodigo} />
              {erro && <MensagemErro>{erro}</MensagemErro>}
              <Botao carregando={carregando}>Confirmar</Botao>
              <button
                type="button"
                onClick={() => {
                  setEtapa("credenciais");
                  setCodigo("");
                  setErro(null);
                }}
                className="w-full text-center text-xs text-gray-400 hover:text-gray-600"
              >
                ← voltar
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function CampoCodigo({ codigo, setCodigo }: { codigo: string; setCodigo: (v: string) => void }) {
  return (
    <Campo label="Código de 6 dígitos">
      <input
        type="text"
        inputMode="numeric"
        required
        autoFocus
        maxLength={6}
        value={codigo}
        onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-center text-lg tracking-[0.4em] focus:border-claro-red focus:outline-none focus:ring-1 focus:ring-claro-red"
        placeholder="000000"
      />
    </Campo>
  );
}

function MensagemErro({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-claro-red-light px-3 py-2 text-xs text-claro-red-dark" role="alert">
      {children}
    </p>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function Botao({ children, carregando }: { children: React.ReactNode; carregando: boolean }) {
  return (
    <button
      type="submit"
      disabled={carregando}
      className="w-full rounded-lg bg-claro-red px-3 py-2.5 text-sm font-medium text-white transition hover:bg-claro-red-dark disabled:opacity-50"
    >
      {carregando ? "aguarde…" : children}
    </button>
  );
}
