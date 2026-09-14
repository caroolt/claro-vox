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
    "cansei disso", "ja liguei", "terceira vez", "quarta vez", "quinta vez",
    "enesima vez", "nunca resolve", "nao aguento", "nao aguento mais", "revoltante",
    "indignad", "furios", "irritad", "estou p da vida", "que descaso", "descaso",
    # xingamentos e expressões vulgares de raiva - comuns num cliente irritado
    # de verdade e que precisam ser reconhecidos como frustração, não ficarem
    # de fora só porque não são "educados"
    "porra", "caralho", "merda", "desgraca", "droga", "cacete", "bosta",
    "inferno", "fdp", "foda", "fuder", "se fuder", "se foder", "puto", "puta",
    "vsf", "pqp", "que saco", "saco cheio", "encheu o saco", "detesto",
    "odeio", "que raiva", "estou puto", "estou furiosa", "que porcaria",
    "lixo de", "incompetente", "inutil", "vergonha", "vergonha alheia",
    "toma no cu", "tomar no cu", "va se catar", "va a merda", "vai a merda",
    "se ferra", "vai se ferrar", "seu lixo", "seu idiota", "otario",
    "arrombado", "desgracado", "cambada de", "raça de",
    # decepção/reclamação formal - tom hostil sem necessariamente ser vulgar
    "decepcionad", "decepcionante", "insatisfeit", "um caos", "isso e um caos",
    "palhacada", "que piada", "brincadeira isso", "sem noção", "sem noçao",
    "sem cabimento", "cade a solucao", "cade a solução", "ninguem resolve",
    "ninguém resolve", "empresa lixo", "atendimento pessimo", "nunca mais",
    "vou processar", "vou no procon", "procon", "reclame aqui", "que roubo",
    "isso e roubo", "e um roubo", "que falta de respeito", "falta de respeito",
    "de novo esse problema", "sempre a mesma coisa", "toda vez e a mesma coisa",
]

PALAVRAS_URGENCIA = [
    "urgente", "urgencia", "e urgente", "agora mesmo", "hoje mesmo", "imediatamente",
    "imediato", "o mais rapido possivel", "com a maior urgencia", "preciso agora",
    "preciso disso agora", "nao pode esperar", "nao da pra esperar", "sem demora",
    "e pra ontem", "para ontem", "neste instante", "nesse instante", "ja ja",
    "correndo", "com pressa", "estou com pressa", "rapido por favor", "por favor rapido",
    "asap", "sem tempo a perder", "nao tenho tempo", "preciso resolver hoje",
    "tem que ser hoje", "antes das", "prazo apertado", "esta acabando o prazo",
    "vence hoje", "vence amanha", "ultimo dia", "ultima chance", "emergencia",
    "e emergencial", "socorro", "nao posso esperar mais", "quanto antes",
    "assim que possivel", "com urgencia", "preciso ja",
]

PALAVRAS_SATISFACAO = [
    "obrigad", "otimo", "otima", "excelente", "maravilha", "maravilhos",
    "sensacional", "perfeito", "perfeita", "adorei", "amei", "gostei muito",
    "super rapido", "muito rapido", "nota dez", "nota 10", "parabens",
    "muito bom", "muito boa", "show", "mandou bem", "top", "incrivel",
    "melhor atendimento", "otimo atendimento", "excelente atendimento",
    "fico grato", "fico grata", "ficou otimo", "agradeco", "valeu", "vlw",
    "bacana", "massa", "de boa", "tudo certo", "satisfeit", "resolveu rapido",
    "resolveram rapido", "gostei do atendimento", "atendimento nota",
]


def _gritando(texto_original: str) -> bool:
    """Detecta 'grito' — mensagem digitada em maiúsculas, sinal comum de
    raiva no chat que se perde ao normalizar o texto para minúsculas."""
    letras = [c for c in texto_original if c.isalpha()]
    if len(letras) < 5:
        return False
    maiusculas = sum(1 for c in letras if c.isupper())
    return (maiusculas / len(letras)) > 0.7


def detectar_tom_emocional(texto_norm: str, texto_original: str = "") -> Optional[str]:
    if any(p in texto_norm for p in PALAVRAS_FRUSTRACAO):
        return "frustracao"
    if texto_original and _gritando(texto_original):
        return "frustracao"
    if any(p in texto_norm for p in PALAVRAS_URGENCIA):
        return "urgencia"
    if any(p in texto_norm for p in PALAVRAS_SATISFACAO):
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
    tom = detectar_tom_emocional(texto_norm, texto)

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

    # Regra de negócio (Seção 5.6/5.7): cliente frustrado (xingamento,
    # grito, expressão de raiva) vai direto para transbordo — não espera
    # uma "segunda tentativa fracassada", pois um cliente já hostil na
    # primeira mensagem não deve ficar preso a respostas automáticas.
    # Cobrança contestada some transborda mesmo sem frustração explícita
    # quando a mesma dúvida se repete (explicação automática não resolveu)
    # — simula o "Cenário 3" documentado.
    requer_transbordo = False
    motivo = None
    if tom == "frustracao":
        requer_transbordo = True
        motivo = (
            "cobrança contestada não resolvida automaticamente + tom emocional negativo"
            if categoria == "atendimento/cobranca_contestada"
            else "cliente demonstrou frustração/tom hostil na mensagem"
        )
    elif categoria == "atendimento/cobranca_contestada" and tentativas_anteriores_falharam:
        requer_transbordo = True
        motivo = "cobrança contestada não resolvida automaticamente"

    return Intencao(categoria, confianca, tom, requer_transbordo, motivo)
