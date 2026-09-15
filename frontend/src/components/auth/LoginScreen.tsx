import { useState } from "react";
import { auth } from "../../api";
import type { Usuario } from "../../types";
import logoClaroVox from "../../assets/claro-vox-logo.png";

type Etapa = "credenciais" | "mfa" | "mfa_configuracao";

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
    <div className="flex h-full items-center justify-center bg-claro-gray-light p-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex justify-center">
          <img src={logoClaroVox} alt="Claro Vox" className="h-7 w-auto" />
        </div>
        <h2 className="mb-1 text-center text-sm font-semibold text-gray-700">Vox Briefing</h2>
        <p className="mb-5 text-center text-xs text-gray-400">Acesso restrito</p>

        {etapa === "credenciais" && (
          <form onSubmit={enviarCredenciais} className="space-y-3">
            <Campo label="E-mail">
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-claro-red focus:outline-none"
                placeholder="voce@clarovox.com"
              />
            </Campo>
            <Campo label="Senha">
              <input
                type="password"
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-claro-red focus:outline-none"
              />
            </Campo>
            {erro && <p className="text-xs text-claro-red">{erro}</p>}
            <Botao carregando={carregando}>Entrar</Botao>
          </form>
        )}

        {etapa === "mfa_configuracao" && (
          <form onSubmit={confirmarCodigo} className="space-y-3">
            <p className="text-xs text-gray-500">
              Primeiro acesso, escaneie este QR code em um app autenticador (Google Authenticator, Authy, etc.) e
              depois digite o código de 6 dígitos gerado.
            </p>
            <div className="flex justify-center">
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="QR code de configuração do MFA"
                  className="h-[180px] w-[180px] rounded-lg border border-gray-100"
                />
              )}
            </div>
            {mfaSecret && (
              <p className="break-all rounded-lg bg-gray-50 p-2 text-center text-[11px] text-gray-500">
                Não consegue escanear? Chave manual: <span className="font-mono">{mfaSecret}</span>
              </p>
            )}
            <Campo label="Código de 6 dígitos">
              <input
                type="text"
                inputMode="numeric"
                required
                autoFocus
                maxLength={6}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-center text-lg tracking-widest focus:border-claro-red focus:outline-none"
                placeholder="000000"
              />
            </Campo>
            {erro && <p className="text-xs text-claro-red">{erro}</p>}
            <Botao carregando={carregando}>Ativar MFA e entrar</Botao>
          </form>
        )}

        {etapa === "mfa" && (
          <form onSubmit={confirmarCodigo} className="space-y-3">
            <p className="text-xs text-gray-500">Digite o código de 6 dígitos do seu app autenticador.</p>
            <Campo label="Código de 6 dígitos">
              <input
                type="text"
                inputMode="numeric"
                required
                autoFocus
                maxLength={6}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-center text-lg tracking-widest focus:border-claro-red focus:outline-none"
                placeholder="000000"
              />
            </Campo>
            {erro && <p className="text-xs text-claro-red">{erro}</p>}
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

function Botao({ children, carregando }: { children: React.ReactNode; carregando: boolean }) {
  return (
    <button
      type="submit"
      disabled={carregando}
      className="w-full rounded-lg bg-claro-red px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
    >
      {carregando ? "aguarde…" : children}
    </button>
  );
}
