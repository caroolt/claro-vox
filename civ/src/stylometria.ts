// stylometria.ts — extração de um "fingerprint" de estilo de escrita a
// partir das mensagens de um cliente (Regra C do motor de fraude). Não usa
// o embedding.ts existente (esse é bag-of-words para RAG — tira stopwords,
// pontuação e maiúsculas, exatamente os traços que aqui interessam manter).
//
// Features propositalmente simples e explicáveis (0 a 1 cada) — cada uma
// pode ser decomposta na UI para justificar o alerta (camada de XAI), em
// vez de um score de modelo opaco.

export interface PerfilEstilo {
  tamanho_medio: number;
  taxa_pontuacao: number;
  taxa_emoji: number;
  taxa_maiusculas: number;
  tamanho_medio_palavra: number;
  diversidade_lexical: number;
}

const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const PONTUACAO_REGEX = /[!?…]|\.\.\./g;

// taxa_pontuacao/taxa_emoji/taxa_maiusculas ficam perto de 0 para a grande
// maioria das mensagens de atendimento (poucas pessoas gritam, usam emoji
// ou pontuação repetida) — sozinhas, quase todo mundo "parece igual" nelas
// (diff ~0 entre dois clientes quaisquer vira falsa similaridade alta).
// tamanho_medio_palavra e diversidade_lexical variam mais entre pessoas
// reais (jeito de escrever, vocabulário) e são o que de fato distingue
// estilos parecidos de coincidência estatística.
export function extrairPerfilEstilo(mensagens: string[]): PerfilEstilo | null {
  if (!mensagens.length) return null;

  let totalChars = 0;
  let totalPontuacao = 0;
  let totalEmoji = 0;
  let totalMaiusculas = 0;
  let totalAlfa = 0;
  let totalPalavras = 0;
  let totalCharsPalavras = 0;
  const vocabulario = new Set<string>();

  for (const msg of mensagens) {
    totalChars += msg.length;
    totalPontuacao += (msg.match(PONTUACAO_REGEX) || []).length;
    totalEmoji += (msg.match(EMOJI_REGEX) || []).length;
    for (const ch of msg) {
      if (/[a-zA-Z]/.test(ch)) {
        totalAlfa++;
        if (ch === ch.toUpperCase()) totalMaiusculas++;
      }
    }
    const palavras = msg.toLowerCase().match(/[a-zà-ú0-9]+/gi) || [];
    for (const p of palavras) {
      totalPalavras++;
      totalCharsPalavras += p.length;
      vocabulario.add(p);
    }
  }

  return {
    tamanho_medio: Math.min(totalChars / mensagens.length / 200, 1),
    taxa_pontuacao: totalChars > 0 ? Math.min((totalPontuacao / totalChars) * 20, 1) : 0,
    taxa_emoji: Math.min(totalEmoji / mensagens.length, 1),
    taxa_maiusculas: totalAlfa > 0 ? totalMaiusculas / totalAlfa : 0,
    tamanho_medio_palavra: totalPalavras > 0 ? Math.min(totalCharsPalavras / totalPalavras / 10, 1) : 0,
    diversidade_lexical: totalPalavras > 0 ? vocabulario.size / totalPalavras : 0,
  };
}

// Similaridade por feature (1 = idêntico, 0 = totalmente diferente) — a
// decomposição que o painel de explicação do frontend mostra por trás do
// número final, em vez de só a média.
export function similaridadePorFeature(a: PerfilEstilo, b: PerfilEstilo): Record<keyof PerfilEstilo, number> {
  const chaves = Object.keys(a) as (keyof PerfilEstilo)[];
  const resultado = {} as Record<keyof PerfilEstilo, number>;
  for (const k of chaves) resultado[k] = 1 - Math.abs(a[k] - b[k]);
  return resultado;
}

export function similaridadeGeral(a: PerfilEstilo, b: PerfilEstilo): number {
  const valores = Object.values(similaridadePorFeature(a, b));
  return valores.reduce((soma, v) => soma + v, 0) / valores.length;
}
