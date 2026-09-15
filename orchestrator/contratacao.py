"""
contratacao.py — fluxo guiado de contratação simulada de plano (pré-pago,
controle ou pós-pago), disparado dentro do próprio chat quando o cliente
demonstra intenção de compra (categoria "venda/contratar_plano").

Coleta, uma pergunta por vez, os mesmos dados de qualquer contratação real:
nome completo, data de nascimento e CPF. Para quem já é cliente da base
(RF011), esses dados são usados para *confirmar* a identidade contra o
cadastro existente; para quem ainda não é cliente (prospecção), os mesmos
dados completam o cadastro e o promovem a cliente ativo.

O estado do fluxo (etapa atual + respostas já dadas) fica em
`contexto.fluxo_dados` na CIV — não em memória do Orquestrador — para
sobreviver entre mensagens e ao reinício do processo, no mesmo espírito do
Cold Start (ver civ/src/routes/coldstart.ts).
"""
import re
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import httpx

FLUXO = "contratacao_plano"

ETAPAS_PLANO = {
    "pre-pago": ["pre pago", "pre-pago", "prepago", "pré-pago", "pre"],
    "controle": ["controle"],
    "pos-pago": ["pos pago", "pos-pago", "pospago", "pós-pago", "ilimitado", "pos"],
}


@dataclass
class ResultadoEtapa:
    resposta: str
    fluxo_dados: Optional[Dict[str, Any]]  # None = fluxo concluído/abortado
    requer_transbordo: bool = False
    motivo_transbordo: Optional[str] = None


def _normalizar(texto: str) -> str:
    return texto.strip().lower()


def _detectar_tipo_plano(texto: str) -> Optional[str]:
    t = _normalizar(texto)
    for tipo, palavras in ETAPAS_PLANO.items():
        if any(p in t for p in palavras):
            return tipo
    return None


def _parsear_data_nascimento(texto: str) -> Optional[str]:
    """Aceita dd/mm/aaaa, dd-mm-aaaa ou aaaa-mm-dd; devolve ISO (aaaa-mm-dd)."""
    t = texto.strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", t)
    if m:
        return t
    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$", t)
    if m:
        dia, mes, ano = m.groups()
        return f"{ano}-{int(mes):02d}-{int(dia):02d}"
    return None


def _parsear_cpf(texto: str) -> Optional[str]:
    digitos = re.sub(r"\D", "", texto)
    return digitos if len(digitos) == 11 else None


def iniciar(nome_cliente: Optional[str]) -> ResultadoEtapa:
    saud = f"{nome_cliente}, " if nome_cliente else ""
    pergunta = f"{saud}vamos contratar seu plano! Qual você prefere: Pré-pago, Controle ou Pós-pago?"
    return ResultadoEtapa(resposta=pergunta, fluxo_dados={"etapa": "tipo_plano"})


async def continuar(
    civ_url: str, sessao_id: str, fluxo_dados: Dict[str, Any], texto: str
) -> ResultadoEtapa:
    etapa = fluxo_dados.get("etapa")

    if etapa == "tipo_plano":
        tipo = _detectar_tipo_plano(texto)
        if not tipo:
            return ResultadoEtapa(
                "Não identifiquei o tipo de plano. Pode escolher entre Pré-pago, Controle ou Pós-pago?",
                fluxo_dados,
            )
        novo = {**fluxo_dados, "tipo_plano": tipo, "etapa": "nome"}
        return ResultadoEtapa(
            "Perfeito! Para confirmar a contratação, preciso de alguns dados. Qual o seu nome completo?",
            novo,
        )

    if etapa == "nome":
        nome = texto.strip()
        if len(nome.split()) < 2:
            return ResultadoEtapa("Pode informar seu nome completo (nome e sobrenome)?", fluxo_dados)
        novo = {**fluxo_dados, "nome": nome, "etapa": "data_nascimento"}
        return ResultadoEtapa("Obrigado! Agora sua data de nascimento (dd/mm/aaaa):", novo)

    if etapa == "data_nascimento":
        data = _parsear_data_nascimento(texto)
        if not data:
            return ResultadoEtapa("Não entendi a data. Pode informar no formato dd/mm/aaaa?", fluxo_dados)
        novo = {**fluxo_dados, "data_nascimento": data, "etapa": "cpf"}
        return ResultadoEtapa("E para finalizar, o seu CPF (só números):", novo)

    if etapa == "cpf":
        cpf = _parsear_cpf(texto)
        if not cpf:
            return ResultadoEtapa("CPF inválido. Digite os 11 números, sem pontos ou traço.", fluxo_dados)
        return await _finalizar(civ_url, sessao_id, {**fluxo_dados, "cpf": cpf})

    # Estado desconhecido/corrompido — aborta o fluxo sem travar a conversa.
    return ResultadoEtapa(
        "Tive um problema para continuar a contratação. Pode tentar de novo dizendo o que deseja contratar?",
        None,
    )


async def _finalizar(civ_url: str, sessao_id: str, dados: Dict[str, Any]) -> ResultadoEtapa:
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.post(
            f"{civ_url}/v1/contratos",
            json={
                "sessao_id": sessao_id,
                "tipo_plano": dados["tipo_plano"],
                "nome": dados["nome"],
                "data_nascimento": dados["data_nascimento"],
                "cpf": dados["cpf"],
            },
        )

    if resp.status_code == 201:
        corpo = resp.json()
        rotulo_plano = {"pre-pago": "Pré-pago", "controle": "Controle", "pos-pago": "Pós-pago"}[dados["tipo_plano"]]
        resposta = (
            f"Prontinho, {dados['nome'].split()[0]}! Seu plano {rotulo_plano} foi contratado com sucesso. "
            f"Protocolo desta solicitação: {corpo['protocolo']}. Posso ajudar com mais alguma coisa?"
        )
        return ResultadoEtapa(resposta, None)

    if resp.status_code == 409:
        corpo = resp.json()
        motivo = corpo.get("erro")
        if motivo == "dados_nao_conferem":
            return ResultadoEtapa(
                "Os dados informados não conferem com o nosso cadastro. Por segurança, vou te transferir para um "
                "atendente confirmar sua identidade antes de prosseguir com a contratação.",
                None,
                requer_transbordo=True,
                motivo_transbordo="divergência de dados na confirmação de identidade (contratação de plano)",
            )
        return ResultadoEtapa(
            "Esse CPF já está associado a outro cadastro. Vou te transferir para um atendente resolver isso.",
            None,
            requer_transbordo=True,
            motivo_transbordo="CPF já pertence a outro cadastro (contratação de plano)",
        )

    return ResultadoEtapa(
        "Não consegui concluir a contratação agora por um problema técnico. Pode tentar novamente em instantes?",
        None,
    )
