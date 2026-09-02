"""
rag.py — recuperação de conhecimento (RAG) sobre a knowledge_base da CIV.

Calcula o embedding da pergunta do cliente localmente (embedding.py) e
delega a busca por similaridade à CIV (POST /v1/knowledge/search), que
executa a consulta pgvector (`<->`, distância de cosseno aproximada
por L2 já que os vetores são normalizados). Mantém a CIV como única
dona do acesso ao Postgres (Seção 4.2 da documentação técnica).
"""
from typing import List, Dict, Any
import httpx

from embedding import embed, _tokenize


async def buscar_conhecimento(civ_url: str, pergunta: str, limite: int = 2) -> List[Dict[str, Any]]:
    """Recuperação em dois estágios: (1) busca vetorial ampla via pgvector
    na CIV (embedding hash-trick, ver embedding.py) e (2) um re-ranqueamento
    leve por sobreposição léxica de tokens entre a pergunta e cada
    documento. O primeiro estágio é o que a arquitetura documenta como RAG
    "de verdade" (ANN sobre embeddings); o segundo compensa, para esta base
    de conhecimento pequena e de demonstração, a perda de precisão
    semântica inerente a um embedding hash-trick de 64 dimensões — a
    mesma técnica (retrieve amplo + re-rank) é comum em pipelines de RAG
    de produção com um reranker dedicado."""
    vetor = embed(pergunta)
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.post(
                f"{civ_url}/v1/knowledge/search",
                json={"embedding": vetor, "limite": max(limite * 3, 4)},
            )
            resp.raise_for_status()
            candidatos = resp.json()
            if not isinstance(candidatos, list):
                return []
        except Exception as e:
            print(f"[orchestrator] RAG: falha ao consultar CIV: {e}")
            return []

    tokens_pergunta = set(_tokenize(pergunta))
    if not tokens_pergunta or not candidatos:
        return candidatos[:limite]

    def pontuacao(doc: Dict[str, Any]) -> tuple:
        tokens_doc = set(_tokenize(f"{doc.get('titulo', '')} {doc.get('conteudo', '')}"))
        sobreposicao = len(tokens_pergunta & tokens_doc)
        distancia = doc.get("distancia", 999)
        return (-sobreposicao, distancia)

    candidatos.sort(key=pontuacao)
    return candidatos[:limite]
