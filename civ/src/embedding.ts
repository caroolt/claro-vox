// Embeddings simplificados para o MVP local (sem chamada a um provedor de
// embeddings externo): hashing trick (FNV-1a) sobre bag-of-words, projetado
// em 64 dimensões e normalizado em L2. Não é semanticamente tão rico quanto
// um embedding de modelo de linguagem, mas é determinístico, roda 100%
// offline e é suficiente para a recuperação por similaridade do RAG nesta
// demonstração. A arquitetura de produção (Seção 4 da documentação técnica)
// usa embeddings do provedor do LLM. A MESMA função (mesmo hash, mesma
// dimensão) precisa existir no Orquestrador Python — ver orchestrator/embedding.py.

const DIM = 64;

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const STOPWORDS = new Set(["de", "a", "o", "que", "e", "do", "da", "em", "um", "uma", "para", "com", "no", "na", "os", "as", "por", "seu", "sua", "ou", "se", "meu", "minha"]);

export function embed(text: string): number[] {
  const vec = new Array(DIM).fill(0);
  const tokens = text
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove acentos
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));

  for (const token of tokens) {
    const idx = fnv1a(token) % DIM;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}
