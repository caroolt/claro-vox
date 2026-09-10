// Anonimização de texto livre para exportações (ex.: conversa em PDF).
//
// Mascara CPF, telefone, e-mail e as ocorrências do nome do cliente dentro
// do corpo das mensagens. É uma rede de segurança por padrão de texto —
// reduz muito o risco de vazar dado pessoal numa exportação, mas NÃO é
// garantia de 100%: um apelido não declarado no cadastro, um endereço
// escrito por extenso ou um documento com formato incomum podem passar.
// Para exclusão definitiva do titular existe a rota LGPD (DELETE /v1/clientes/:id).

const RE_CPF = /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g;
const RE_EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi;
// Telefone BR: DDD opcional entre parênteses ou não, nono dígito opcional,
// separador opcional entre os dois blocos finais (4+4).
const RE_TELEFONE = /\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g;

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scrubTexto(texto: string | null | undefined, nomeCliente?: string | null): string {
  if (!texto) return "";
  let out = texto;

  // Ordem importa: CPF antes de telefone (11 dígitos sem pontuação também
  // casariam parcialmente na regex de telefone).
  out = out.replace(RE_CPF, "***.***.***-**");
  out = out.replace(RE_EMAIL, "***@***");
  out = out.replace(RE_TELEFONE, "(**) *****-****");

  if (nomeCliente) {
    const tokens = nomeCliente
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3)
      .map(escaparRegex);
    if (tokens.length) {
      const reNome = new RegExp(`\\b(${tokens.join("|")})\\b`, "gi");
      out = out.replace(reNome, "[nome]");
    }
  }

  return out;
}
