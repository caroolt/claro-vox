"""
main.py — Orquestrador (Python + FastAPI) do Claro Vox.

Responsável pela camada de raciocínio conversacional: classifica a
intenção e o tom emocional de cada mensagem, consulta a base de
conhecimento (RAG) quando necessário, gera a resposta do Vox e decide
quando acionar o transbordo para atendimento humano (RF007-009). Todo
o estado durável (sessões, mensagens, contexto, briefings) é lido e
gravado através da API da CIV — o Orquestrador não acessa o Postgres
diretamente, exatamente como descrito na Seção 4.2 da documentação
técnica (separação de responsabilidades entre Identidade e Raciocínio).
"""
import os
from typing import Optional, Dict, Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import contratacao
import llm
import nlu
from rag import buscar_conhecimento

load_dotenv()

CIV_URL = os.getenv("CIV_URL", "http://localhost:4001")
PORT = int(os.getenv("PORT", "4002"))

app = FastAPI(title="Claro Vox · Orquestrador", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class MensagemIn(BaseModel):
    sessao_id: str
    canal: str
    conteudo: str


class ColdstartStartIn(BaseModel):
    canal: str
    canal_conversa_id: str
    mensagem_inicial: Optional[str] = None


class ColdstartAnswerIn(BaseModel):
    sessao_id: str
    resposta: str


class ReconhecerIn(BaseModel):
    canal: str
    cpf: str


# ----------------------------------------------------------------------
# Templates de resposta por categoria — usados quando o LLM real (Claude)
# não está configurado (ver llm.py). Cobrem os cenários da Seção 5.7.
# ----------------------------------------------------------------------
def _resposta_template(categoria: str, tom: Optional[str], trechos: list, nome_cliente: Optional[str]) -> str:
    saud = f"{nome_cliente}, " if nome_cliente else ""
    # Trecho da base de conhecimento mais relevante para a mensagem atual
    # (já filtrado e re-ranqueado em rag.py). Quando existe, ele entra na
    # resposta no lugar da frase fixa, para a resposta variar de acordo com
    # o que o cliente perguntou em vez de repetir sempre o mesmo texto por
    # categoria.
    trecho_txt = trechos[0].get("conteudo") if trechos else None

    if categoria == "atendimento/cobranca_contestada":
        detalhe = f" {trecho_txt}" if trecho_txt else ""
        return (
            f"{saud}entendo, vou verificar a cobrança na sua fatura mais recente.{detalhe} "
            "Não encontrei um motivo técnico óbvio para o valor divergente aqui no meu histórico automático. "
            "Vou te transferir para um especialista humano com todo o seu contexto, para não precisar repetir nada."
        )
    if categoria == "atendimento/2via_fatura":
        if trecho_txt:
            return f"{saud}{trecho_txt} Precisa de mais alguma coisa?"
        return f"{saud}sua 2ª via já está disponível. Vou te enviar o link por aqui mesmo, algo mais que eu possa ajudar?"
    if categoria == "atendimento/consulta_fatura":
        if trecho_txt:
            return f"{saud}{trecho_txt} Quer que eu detalhe algum item específico?"
        return f"{saud}posso te ajudar com sua fatura. Você quer o valor, a data de vencimento ou o detalhamento dos serviços?"
    if categoria == "atendimento/suporte_tecnico":
        if trecho_txt:
            return f"{saud}sinto muito pelo transtorno. {trecho_txt}"
        return (
            f"{saud}sinto muito pelo transtorno. Vou rodar um diagnóstico remoto no seu sinal agora. "
            "Enquanto isso, já tenta reiniciar o roteador? Costuma resolver na maioria dos casos."
        )
    if categoria == "atendimento/reagendar_visita":
        if trecho_txt:
            return f"{saud}{trecho_txt} Qual data e período funcionam melhor pra você?"
        return f"{saud}sem problemas, vamos reagendar. Tenho horários amanhã de manhã ou depois de amanhã à tarde, qual prefere?"
    if categoria == "atendimento/alterar_plano":
        if trecho_txt:
            return f"{saud}{trecho_txt} Quer que eu já prepare essa mudança?"
        return f"{saud}posso te mostrar as opções de planos disponíveis para o seu perfil. Quer mais dados, mais minutos, ou os dois?"
    if categoria == "venda/cancelamento":
        detalhe = f" {trecho_txt}" if trecho_txt else ""
        return (
            f"{saud}antes de seguir com o cancelamento, queria entender o que está acontecendo.{detalhe} "
            "Às vezes consigo resolver o motivo sem precisar cancelar. Pode me contar o que houve?"
        )
    if categoria == "atendimento/negociar_divida":
        if trecho_txt:
            return f"{saud}{trecho_txt} Prefere parcelar ou pagar à vista com desconto?"
        return f"{saud}posso verificar condições de negociação para o seu débito em aberto. Prefere parcelar ou pagar à vista com desconto?"
    if categoria == "venda/consulta_portfolio":
        if trecho_txt:
            return f"{saud}sobre isso: {trecho_txt} Quer que eu detalhe outro plano ou já seguimos com esse?"
        return f"{saud}temos algumas opções de planos que podem te interessar. Me conta se busca mais internet, mais minutos, ou um combo."
    if categoria == "atendimento/atendente_humano":
        return f"{saud}claro, já vou te conectar com um atendente humano com todo o histórico da nossa conversa."

    if trecho_txt:
        return f"{saud}encontrei isso que pode ajudar: {trecho_txt}"
    return f"{saud}entendi. Pode me dar mais detalhes para eu te ajudar melhor?"


async def _civ_get(path: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(f"{CIV_URL}{path}")
        resp.raise_for_status()
        return resp.json()


async def _civ_post(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.post(f"{CIV_URL}{path}", json=payload)
        resp.raise_for_status()
        return resp.json()


@app.get("/health")
async def health():
    civ_ok = True
    try:
        await _civ_get("/health")
    except Exception:
        civ_ok = False
    return {"status": "ok", "servico": "orchestrator", "llm_ativo": llm.llm_disponivel(), "civ_alcancavel": civ_ok}


# ----------------------------------------------------------------------
# Proxies finos para o fluxo de Cold Start (RF010/RF011) — o Orquestrador
# expõe um único endpoint-base para o frontend conversar, delegando a
# gravação de estado à CIV.
# ----------------------------------------------------------------------
@app.post("/v1/orchestrator/coldstart/start")
async def coldstart_start(body: ColdstartStartIn):
    try:
        return await _civ_post("/v1/coldstart/start", body.model_dump())
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)


@app.post("/v1/orchestrator/coldstart/answer")
async def coldstart_answer(body: ColdstartAnswerIn):
    try:
        return await _civ_post("/v1/coldstart/answer", body.model_dump())
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)


@app.post("/v1/orchestrator/coldstart/reconhecer")
async def coldstart_reconhecer(body: ReconhecerIn):
    try:
        return await _civ_post("/v1/coldstart/reconhecer", body.model_dump())
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)


# ----------------------------------------------------------------------
# Endpoint principal: processa uma mensagem do cliente já dentro de uma
# sessão ATIVA (RF001, RF002, RF007-009).
# ----------------------------------------------------------------------
@app.post("/v1/orchestrator/message")
async def processar_mensagem(body: MensagemIn):
    sessao_id = body.sessao_id

    try:
        contexto = await _civ_get(f"/v1/sessions/{sessao_id}/context")
    except httpx.HTTPStatusError:
        raise HTTPException(status_code=404, detail="sessão não encontrada na CIV")

    nome_cliente = (contexto.get("cliente") or {}).get("nome")
    ultima_intencao = contexto.get("ultima_intencao") or {}
    categoria_anterior = ultima_intencao.get("categoria") if isinstance(ultima_intencao, dict) else None
    fluxo_ativo = contexto.get("fluxo_ativo")
    fluxo_dados = contexto.get("fluxo_dados") or {}

    # 1) registra a mensagem do cliente
    msg_cliente = await _civ_post(
        f"/v1/sessions/{sessao_id}/messages",
        {"remetente": "cliente", "canal": body.canal, "conteudo": body.conteudo},
    )

    # 2) classificação (LLM real se configurado, senão motor de regras) — a
    # menos que já exista (ou esteja começando agora) um fluxo guiado de
    # contratação de plano, que é tratado à parte (determinístico, sem LLM
    # nem RAG, já que é uma coleta estruturada de dados — nome/nascimento/CPF).
    #
    # categoria_provisoria é a classificação "fresca" (sem levar em conta a
    # categoria_anterior) — usada tanto para detectar o início do fluxo de
    # contratação quanto, mais abaixo, para corrigir o texto de resposta
    # quando o assunto muda sem palavra-chave nova (ver comentário adiante).
    intencao_fresca = nlu.classificar(body.conteudo)
    categoria_provisoria = intencao_fresca.categoria

    resultado_fluxo = None
    if fluxo_ativo == contratacao.FLUXO:
        resultado_fluxo = await contratacao.continuar(CIV_URL, sessao_id, fluxo_dados, body.conteudo)
    elif categoria_provisoria == "venda/contratar_plano":
        resultado_fluxo = contratacao.iniciar(nome_cliente)

    trechos = []
    llm_resultado = None
    if resultado_fluxo is not None:
        categoria = "venda/contratar_plano"
        tom = intencao_fresca.tom_emocional
        resposta_texto = resultado_fluxo.resposta
        requer_transbordo = resultado_fluxo.requer_transbordo
        motivo_transbordo = resultado_fluxo.motivo_transbordo
        fonte_classificacao = "fluxo_contratacao"
        # Persiste em que etapa o fluxo está (ou encerra, se concluído/abortado).
        await _civ_post(
            f"/v1/sessions/{sessao_id}/fluxo",
            {
                "fluxo_ativo": contratacao.FLUXO if resultado_fluxo.fluxo_dados else None,
                "fluxo_dados": resultado_fluxo.fluxo_dados,
            },
        )
    else:
        # Busca de conhecimento (RAG) — consultada sempre, para qualquer
        # categoria poder citar um trecho real da base em vez de repetir a
        # mesma frase fixa (a própria busca já retorna vazio quando não há
        # nada relevante).
        trechos = await buscar_conhecimento(CIV_URL, body.conteudo)

        llm_resultado = llm.classificar_e_responder(body.conteudo, contexto, trechos)

        if llm_resultado:
            categoria = llm_resultado.get("categoria", categoria_provisoria)
            tom = llm_resultado.get("tom_emocional", "neutro")
            resposta_texto = llm_resultado.get("resposta") or _resposta_template(categoria, tom, trechos, nome_cliente)
            requer_transbordo = bool(llm_resultado.get("requer_transbordo", False))
            motivo_transbordo = "classificado pelo LLM como necessitando atendimento humano" if requer_transbordo else None
            fonte_classificacao = "llm"
        else:
            intencao = nlu.classificar(body.conteudo, categoria_anterior)
            categoria = intencao.categoria
            tom = intencao.tom_emocional
            requer_transbordo = intencao.requer_transbordo
            motivo_transbordo = intencao.motivo_transbordo
            # A "continuidade" (ver nlu.classificar) assume que uma mensagem sem
            # palavra-chave nova segue o mesmo assunto anterior — ótimo quando o
            # cliente insiste no mesmo problema, mas erra quando ele muda de
            # assunto sem usar as palavras que o motor de regras reconhece: a
            # categoria antiga gruda e o texto de resposta acaba com a pergunta
            # de fechamento do assunto errado. Quando isso acontece (a
            # classificação fresca não viu nada de novo, mas a busca de
            # conhecimento achou algo relevante pro que foi perguntado agora),
            # usa a categoria fresca (genérica) só na escolha do texto. A
            # categoria "grudenta" continua valendo pra decisão de transbordo e
            # pro que fica registrado como intenção da sessão, que é intencional.
            categoria_para_resposta = categoria
            if categoria_provisoria == "atendimento/duvida_geral" and categoria != categoria_provisoria and trechos:
                categoria_para_resposta = categoria_provisoria
            resposta_texto = _resposta_template(categoria_para_resposta, tom, trechos, nome_cliente)
            fonte_classificacao = "regras"

        # Sempre que o transbordo é acionado fora de um fluxo guiado, o Vox
        # avisa o cliente antes de transferir — mensagem fixa, para deixar
        # claro que a partir dali um atendente humano assume a conversa
        # (RF007-009). Dentro do fluxo de contratação a mensagem já é
        # específica (explica a divergência de dados), então não é sobrescrita.
        if requer_transbordo:
            resposta_texto = (
                "Não consigo te ajudar com isso. Estou te transferindo para um atendente! "
                "Antes disso, de 0 a 10, o quanto você recomendaria o atendimento do assistente virtual?"
            )

    # 3) registra a resposta do Vox
    msg_vox = await _civ_post(
        f"/v1/sessions/{sessao_id}/messages",
        {"remetente": "vox", "canal": body.canal, "conteudo": resposta_texto},
    )

    # 4) registra a intenção classificada (RF002/RF008) e atualiza o contexto
    await _civ_post(
        f"/v1/sessions/{sessao_id}/intencao",
        {
            "mensagem_id": msg_cliente.get("mensagem_id"),
            "categoria": categoria,
            "subcategoria": None,
            "confianca": llm_resultado.get("confianca") if llm_resultado else 0.85,
            "tom_emocional": tom,
            "jornada_status": "AGUARDANDO_TRANSBORDO" if requer_transbordo else "EM_ANDAMENTO",
        },
    )

    briefing_id = None
    if requer_transbordo:
        sugestao = (
            trechos[0]["conteudo"] if trechos else
            "Revisar histórico completo da sessão e decidir a melhor forma de resolver com o cliente."
        )
        resumo = f"Cliente {nome_cliente or '(não identificado)'}, intenção: {categoria}. Última mensagem: \"{body.conteudo}\"."
        handoff_resp = await _civ_post(
            "/v1/handoff",
            {
                "sessao_id": sessao_id,
                "motivo": motivo_transbordo or "transbordo solicitado",
                "tom_emocional": tom,
                "resumo_jornada": resumo,
                "sugestao_resolucao": sugestao,
            },
        )
        briefing_id = handoff_resp.get("briefing_id")

    return {
        "sessao_id": sessao_id,
        "resposta": resposta_texto,
        "categoria": categoria,
        "tom_emocional": tom,
        "transbordo": requer_transbordo,
        "briefing_id": briefing_id,
        "fonte_classificacao": fonte_classificacao,
        "trechos_conhecimento_usados": [t.get("titulo") for t in trechos],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
