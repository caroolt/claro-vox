"""
llm.py — integração opcional com um LLM real (Google Gemini) via SDK
oficial google-genai.

Se GEMINI_API_KEY estiver definida no .env do Orquestrador, as
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

_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
_client = None
_types = None

if _API_KEY:
    try:
        from google import genai
        from google.genai import types as _types
        _client = genai.Client(api_key=_API_KEY)
    except Exception as e:
        print(f"[orchestrator] llm: falha ao inicializar SDK Gemini, usando fallback por regras: {e}")
        _client = None

MODEL = os.getenv("GEMINI_MODEL", "").strip() or "gemini-2.5-flash"


def llm_disponivel() -> bool:
    return _client is not None


def classificar_e_responder(
    mensagem_cliente: str,
    contexto: Dict[str, Any],
    trechos_conhecimento: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """Usa o Gemini para classificar a intenção e já gerar a resposta em uma
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
        resp = _client.models.generate_content(
            model=MODEL,
            contents=user,
            config=_types.GenerateContentConfig(
                system_instruction=system,
                # Folga para o raciocínio interno dos modelos 2.5+, que também
                # consome tokens de saída; desligado no Flash para reduzir latência.
                max_output_tokens=2048,
                response_mime_type="application/json",
                thinking_config=_types.ThinkingConfig(thinking_budget=0) if MODEL.startswith("gemini-2.5-flash") else None,
            ),
        )
        return json.loads(resp.text or "")
    except Exception as e:
        print(f"[orchestrator] llm: chamada falhou, usando fallback por regras: {e}")
        return None
