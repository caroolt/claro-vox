"""
embedding.py — porta em Python do civ/src/embedding.ts.

Implementa EXATAMENTE o mesmo algoritmo (hashing trick FNV-1a sobre
bag-of-words, 64 dimensões, normalização L2) para que os vetores
calculados aqui sejam comparáveis (via distância pgvector `<->`) com
os vetores já gravados em knowledge_base.embedding por civ/src/seed.ts.

MVP: isto substitui um provedor de embeddings real (que exigiria uma
chave de API paga). A arquitetura de produção documentada usa
embeddings do provedor do LLM (Seção 4 da documentação técnica); aqui
usamos um esquema determinístico e local para a demonstração poder
rodar 100% offline, com a MESMA função implementada nos dois lados
(TypeScript e Python) — ver civ/src/embedding.ts.
"""
import math
import re
import unicodedata
from typing import List

DIM = 64
FNV_OFFSET_BASIS = 0x811C9DC5
FNV_PRIME = 0x01000193
MASK32 = 0xFFFFFFFF

# Mesma lista de STOPWORDS de civ/src/embedding.ts
STOPWORDS = {
    "de", "a", "o", "que", "e", "do", "da", "em", "um", "uma", "para",
    "com", "no", "na", "os", "as", "por", "seu", "sua", "ou", "se",
    "meu", "minha",
}


def _fnv1a(token: str) -> int:
    h = FNV_OFFSET_BASIS
    for ch in token:
        h ^= ord(ch)
        h = (h * FNV_PRIME) & MASK32
    return h


def _strip_accents(text: str) -> str:
    nfd = unicodedata.normalize("NFD", text)
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn")


def _tokenize(text: str) -> List[str]:
    lowered = _strip_accents(text.lower())
    raw = re.split(r"[^a-z0-9]+", lowered)
    return [t for t in raw if len(t) > 1 and t not in STOPWORDS]


def embed(text: str) -> List[float]:
    vec = [0.0] * DIM
    for token in _tokenize(text or ""):
        idx = _fnv1a(token) % DIM
        vec[idx] += 1
    norm = math.sqrt(sum(v * v for v in vec)) or 1
    return [v / norm for v in vec]


def to_pgvector_literal(vec: List[float]) -> str:
    return "[" + ",".join(f"{v:.8f}" for v in vec) + "]"
