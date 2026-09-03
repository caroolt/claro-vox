"""
rag.py — recuperação de conhecimento (RAG) sobre a knowledge_base da CIV.

Calcula o embedding da pergunta do cliente localmente (embedding.py) e
delega a busca por similaridade à CIV (POST /v1/knowledge/search), que
executa a consulta pgvector (`<->`, distância de cosseno aproximada
por L2 já que os vetores são normalizados). Mantém a CIV como única
dona do acesso ao Postgres (Seção 4.2 da documentação técnica).
"""
from typing import List, Dict, Any, Set
import httpx

from embedding import embed, _tokenize

# Palavras genéricas demais para contar como "relevância" no re-ranqueamento
# (verbos e pronomes comuns de uma pergunta de cliente). Não é a mesma lista
# de STOPWORDS do embedding.py — aquela precisa ficar idêntica entre
# TypeScript e Python para os vetores baterem; esta é só um filtro adicional,
# usado apenas para decidir qual trecho citar na resposta.
PALAVRAS_VAZIAS_RERANK = {
    "eu", "voce", "vc", "ele", "ela", "nos", "eles", "elas", "esse", "essa",
    "esses", "essas", "isso", "isto", "aquele", "aquela", "aqui", "ali",
    "la", "ja", "so", "ta", "tava", "tenho", "tem", "tinha", "acho", "achei",
    "queria", "quero", "quer", "gostaria", "poderia", "pode", "consegue",
    "saber", "sobre", "outro", "outra", "outros", "outras", "algum",
    "alguma", "alguns", "algumas", "muito", "muita", "muitos", "muitas",
    "bem", "mal", "bom", "boa", "coisa", "ne", "entao", "agora", "ainda",
    "vai", "vou", "fazer", "fica", "ficou", "sendo", "sido", "porque",
    "pois", "onde", "quando", "como", "qual", "quais",
}


def _radical(token: str) -> str:
    """Heurística bem simples de plural -> singular (não é um stemmer de
    verdade): 'planos' -> 'plano', 'ligacoes' fica como está. Suficiente
    para o tamanho da base de conhecimento desta demonstração."""
    if len(token) > 4 and token.endswith("s") and not token.endswith("ns"):
        return token[:-1]
    return token


def _termos_relevantes(texto: str) -> Set[str]:
    tokens = _tokenize(texto)
    return {_radical(t) for t in tokens if t not in PALAVRAS_VAZIAS_RERANK}


async def buscar_conhecimento(civ_url: str, pergunta: str, limite: int = 2) -> List[Dict[str, Any]]:
    """Recuperação em dois estágios: (1) busca vetorial ampla via pgvector
    na CIV (embedding hash-trick, ver embedding.py) e (2) um re-ranqueamento
    por sobreposição de termos "de conteúdo" (com pronomes/verbos genéricos
    filtrados e uma normalização simples de plural) entre a pergunta e cada
    documento. Se nenhum candidato tiver nenhum termo relevante em comum com
    a pergunta, a função retorna lista vazia em vez de citar um trecho
    escolhido só pela distância vetorial (que sozinha, com um embedding tão
    simples, não é confiável o bastante) — evita responder "algo genérico
    porém errado" quando não há de fato um artigo relevante."""
    vetor = embed(pergunta)
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.post(
                f"{civ_url}/v1/knowledge/search",
                json={"embedding": vetor, "limite": max(limite * 3, 6)},
            )
            resp.raise_for_status()
            candidatos = resp.json()
            if not isinstance(candidatos, list):
                return []
        except Exception as e:
            print(f"[orchestrator] RAG: falha ao consultar CIV: {e}")
            return []

    if not candidatos:
        return []

    termos_pergunta = _termos_relevantes(pergunta)
    if not termos_pergunta:
        return []

    pontuados = []
    for doc in candidatos:
        termos_doc = _termos_relevantes(f"{doc.get('titulo', '')} {doc.get('conteudo', '')}")
        sobreposicao = len(termos_pergunta & termos_doc)
        distancia = doc.get("distancia", 999)
        pontuados.append((sobreposicao, distancia, doc))

    pontuados.sort(key=lambda x: (-x[0], x[1]))

    # só cita um trecho se ele tiver ao menos um termo de conteúdo em comum
    # com a pergunta — caso contrário, "não achamos nada específico" é uma
    # resposta melhor do que citar um artigo aleatório.
    relevantes = [doc for (sobreposicao, _dist, doc) in pontuados if sobreposicao > 0]
    return relevantes[:limite]
