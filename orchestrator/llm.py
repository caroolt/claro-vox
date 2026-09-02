"""
llm.py — integração opcional com um LLM real (Claude Haiku 4.5) via SDK
oficial da Anthropic.

Se ANTHROPIC_API_KEY estiver definida no .env do Orquestrador, as
funções abaixo usam o modelo de verdade para classificar a intenção e
gerar a resposta em linguagem natural. Sem a chave (caso padrão desta
demonstração local), retornam None e o main.py cai automaticamente no
motor baseado em regras (nlu.py) + respostas por template — a
arquitetura de produção documentada usa o LLM para as duas etapas,
mas o MVP precisa rodar 100% offline neste ambiente de sandbox.
"""
import os
import json
from typing import Optional, Dict, Any, List

_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
_client = None

if _API_KEY:
    try:
        import anthropic
        _client = anthropic.Anthropic(api_key=_API_KEY)
    except Exception as e:
        print(f"[orchestrator] llm: falha ao inicializar SDK Anthropic, usando fallback por regras: {e}")
        _client = None

MODEL = "claude-haiku-4-5-20251001"


def llm_disponivel() -> bool:
    return _client is not None


def classificar_e_responder(
    mensagem_cliente: str,
    contexto: Dict[str, Any],
    trechos_conhecimento: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """Usa Claude para classificar a intenção e já gerar a resposta em uma
    única chamada (reduz latência para a demonstração). Retorna None se o
    LLM não estiver configurado ou se a chamada falhar (fallback por regras
    assume automaticamente)."""
    if not _client:
        return None

    contexto_txt = json.dumps(contexto, ensure_ascii=False, default=str)
    conhecimento_txt = "\n".join(
        f"- {t.get('titulo')}: {t.get('conteudo')}" for t in (trechos_conhecimento or [])
    ) or "(nenhum trecho relevante recuperado)"

    system = (
        "Você é o Vox, o assistente conversacional da Claro Brasil. Responda "
        "de forma breve (2-4 frases), cordial e objetiva, em português do "
        "Brasil. Classifique também a intenção do cliente. "
        "Responda SOMENTE em JSON válido com as chaves: "
        "resposta (string), categoria (string, formato area/subcategoria), "
        "tom_emocional (um de: neutro, frustracao, urgencia, satisfacao), "
        "requer_transbordo (boolean)."
    )
    user = (
        f"Contexto da sessão: {contexto_txt}\n\n"
        f"Trechos da base de conhecimento (RAG):\n{conhecimento_txt}\n\n"
        f"Mensagem do cliente: {mensagem_cliente}"
    )

    try:
        resp = _client.messages.create(
            model=MODEL,
            max_tokens=400,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        texto = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
        return json.loads(texto)
    except Exception as e:
        print(f"[orchestrator] llm: chamada falhou, usando fallback por regras: {e}")
        return None
