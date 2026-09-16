// Verificação de identidade (nome digitado x nome em cadastro) — usada em
// qualquer ponto onde o cliente afirma já ser cliente e precisa confirmar
// quem é (contratação de plano, reconhecimento no Cold Start). Mantida num
// só lugar pra não desalinhar critério entre os dois fluxos.

function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Confere se o nome digitado bate com o nome em cadastro — exige que ao
// menos o primeiro nome coincida (tolera sobrenome digitado diferente,
// mas não deixa passar uma pessoa diferente).
export function nomesConferem(digitado: string, cadastrado: string): boolean {
  const a = normalizarNome(digitado).split(/\s+/)[0] || "";
  const b = normalizarNome(cadastrado).split(/\s+/)[0] || "";
  return !!a && a === b;
}
