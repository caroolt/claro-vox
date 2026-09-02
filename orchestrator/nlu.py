"""
nlu.py — motor de classificação de intenção baseado em regras
(fallback quando ANTHROPIC_API_KEY não está configurada — ver llm.py).

Cobre os cenários documentados na Seção 5.7 do documento técnico
Claro Vox (Sprint 2), incluindo o Cenário 3 (cobrança contestada) que
dispara transbordo. Cada regra é uma lista de palavras-chave; a
primeira que bater em qualquer parte do texto (normalizado, sem
acento) decide a intenção.
"""
import re
import unicodedata
from dataclasses import dataclass
from typing import List, Optional


def _norm(text: str) -> str:
    nfd = unicodedata.normalize("NFD", text.lower())
    sem_acento = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    return sem_acento


@dataclass
class Intencao:
    categoria: str
    confianca: float
    tom_emocional: Optional[str]
    requer_transbordo: bool
    motivo_transbordo: Optional[str] = None


# (categoria, [conjuntos de palavras-chave — todas do conjunto precisam aparecer])
REGRAS = [
    ("atendimento/cobranca_contestada", [["cobranca", "indevida"]], False),
    ("atendimento/cobranca_contestada", [["fatura", "errada"]], False),
    ("atendimento/cobranca_contestada", [["nao", "reconheco"]], False),
    ("atendimento/cobranca_contestada", [["contest"]], False),
    ("atendimento/2via_fatura", [["2 via"], ["segunda via"], ["2via"]], False),
    ("atendimento/consulta_fatura", [["fatura"], ["boleto"], ["conta veio"]], False),
    ("atendimento/suporte_tecnico", [["internet lenta"], ["sem sinal"], ["nao conecta"], ["wifi"], ["sem internet"], ["caiu a"]], False),
    ("atendimento/reagendar_visita", [["reagendar"], ["remarcar", "visita"], ["tecnico nao veio"]], False),
    ("atendimento/alterar_plano", [["mudar de plano"], ["trocar", "plano"], ["upgrade"], ["downgrade"]], False),
    ("venda/cancelamento", [["cancelar"], ["quero sair"], ["encerrar", "contrato"]], False),
    ("atendimento/negociar_divida", [["negociar", "divida"], ["estou devendo"], ["em atraso"]], False),
    ("venda/consulta_portfolio", [["plano"], ["planos"], ["pacote"], ["gb"], ["oferta"], ["promocao"]], False),
    ("atendimento/atendente_humano", [["atendente"], ["humano"], ["pessoa de verdade"], ["falar com alguem"], ["supervisor"]], True),
]

PALAVRAS_FRUSTRACAO = [
    "absurdo", "ridiculo", "pessimo", "horrivel", "cansado disso", "cansada disso",
    "ja liguei", "terceira vez", "nunca resolve", "nao aguento", "revoltante",
    "indignad", "furios", "irritad", "estou p da vida", "que descaso",
]

PALAVRAS_URGENCIA = ["urgente", "agora mesmo", "hoje mesmo", "imediatamente"]


def detectar_tom_emocional(texto_norm: str) -> Optional[str]:
    if any(p in texto_norm for p in PALAVRAS_FRUSTRACAO):
        return "frustracao"
    if any(p in texto_norm for p in PALAVRAS_URGENCIA):
        return "urgencia"
    if "obrigad" in texto_norm or "otimo" in texto_norm or "excelente" in texto_norm:
        return "satisfacao"
    return "neutro"


def classificar(texto: str, categoria_anterior: Optional[str] = None) -> Intencao:
    """Classifica a mensagem atual, considerando a categoria da última
    intenção registrada na sessão (categoria_anterior) para dar
    continuidade ao mesmo assunto quando a mensagem atual não traz
    palavras-chave novas — por exemplo, uma segunda mensagem só de
    desabafo ("isso é um absurdo...") após uma cobrança contestada
    continua sendo tratada como o mesmo caso, e não uma dúvida genérica.
    """
    texto_norm = _norm(texto)
    tom = detectar_tom_emocional(texto_norm)

    categoria_detectada: Optional[str] = None
    confianca = 0.4
    for cat, grupos_palavras, transbordo_direto in REGRAS:
        for grupo in grupos_palavras:
            if all(palavra in texto_norm for palavra in grupo):
                categoria_detectada = cat
                confianca = 0.85
                if transbordo_direto:
                    return Intencao(cat, confianca, tom, True, "cliente solicitou atendente humano")
                break
        if categoria_detectada:
            break

    continuidade = False
    if categoria_detectada:
        categoria = categoria_detectada
    elif categoria_anterior and categoria_anterior != "atendimento/duvida_geral":
        # sem palavras-chave novas: assume que é continuação do assunto anterior
        categoria = categoria_anterior
        confianca = 0.55
        continuidade = True
    else:
        categoria = "atendimento/duvida_geral"
        confianca = 0.4

    tentativas_anteriores_falharam = continuidade or (categoria_anterior == categoria and categoria_anterior is not None)

    # Regra de negócio (Seção 5.6/5.7): cobrança contestada vai para
    # transbordo se a explicação automática não resolveu (frustração
    # detectada OU já é a 2ª mensagem sobre o mesmo caso na sessão) —
    # simula o "Cenário 3" documentado.
    requer_transbordo = False
    motivo = None
    if categoria == "atendimento/cobranca_contestada" and (tom == "frustracao" or tentativas_anteriores_falharam):
        requer_transbordo = True
        motivo = "cobrança contestada não resolvida automaticamente + tom emocional negativo"
    elif tom == "frustracao" and tentativas_anteriores_falharam:
        requer_transbordo = True
        motivo = "cliente frustrado após tentativa automática sem sucesso"

    return Intencao(categoria, confianca, tom, requer_transbordo, motivo)
