import crypto from "crypto";

const SECRET = process.env.CPF_HASH_SECRET || "troque-este-segredo-em-producao";

// HMAC-SHA-256 determinístico — o mesmo CPF sempre gera o mesmo hash,
// o que permite localizar o cliente sem reter o número original (Seção 4.6).
export function hashCpf(cpfRaw: string): string {
  const digits = cpfRaw.replace(/\D/g, "");
  return crypto.createHmac("sha256", SECRET).update(digits).digest("hex");
}

export function maskCpf(cpfRaw: string): string {
  const d = cpfRaw.replace(/\D/g, "");
  if (d.length !== 11) return "***.***.***-**";
  return `***.${d.slice(3, 6)}.***-${d.slice(9, 11)}`;
}
