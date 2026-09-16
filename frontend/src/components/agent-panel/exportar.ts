import { civ, fraude } from "../../api";
import type { AlertaFraude, Briefing, Metrics, SessaoResumo, Transcript } from "../../types";
import { CANAL_META, ESTADO_META, fmtDataHora, TOM_META } from "./meta";

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

// Delimitador ";" + BOM UTF-8: é o que o Excel pt-BR espera para abrir o
// arquivo já com colunas separadas e acentuação correta.
function csvValor(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  const precisaAspas = s.includes('"') || s.includes(";") || s.includes("\n") || s.includes("\r");
  return precisaAspas ? `"${s.replace(/"/g, '""')}"` : s;
}

export function linhasParaCsv(linhas: Record<string, unknown>[]): string {
  if (!linhas.length) return "";
  const cols = Object.keys(linhas[0]);
  const head = cols.map(csvValor).join(";");
  const corpo = linhas.map((l) => cols.map((c) => csvValor(l[c])).join(";")).join("\r\n");
  return `${head}\r\n${corpo}`;
}

// BOM UTF-8 (U+FEFF) na frente para o Excel abrir com acentuação correta.
const comBom = (csv: string) => String.fromCharCode(0xfeff) + csv;

function carimboArquivo(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function linhaSessao(s: SessaoResumo) {
  const intencao = s.ultima_intencao && typeof s.ultima_intencao === "object" ? s.ultima_intencao : {};
  return {
    sessao_id: s.id,
    cliente: s.cliente_nome ?? "",
    tipo_cliente: s.tipo_cliente ?? "",
    canal: s.canal ?? "",
    estado: s.estado,
    criado_em: s.criado_em,
    atualizado_em: s.atualizado_em,
    ultima_intencao: intencao.categoria ?? "",
    tom_emocional: intencao.tom_emocional ?? "",
  };
}

function linhaBriefing(b: Briefing) {
  return {
    briefing_id: b.id,
    sessao_id: b.sessao_id,
    cliente: b.cliente_nome ?? "",
    canal: b.canal ?? "",
    estado_sessao: b.sessao_estado,
    tom_emocional: b.tom_emocional,
    motivo_transbordo: b.motivo_transbordo,
    atendente_id: b.atendente_id ?? "",
    gerado_em: b.gerado_em,
    assumido_em: b.assumido_em ?? "",
    encerrado_em: b.encerrado_em ?? "",
  };
}

function linhaAlertaFraude(a: AlertaFraude) {
  const envolvidos = (a.evidencia.clientes as { id: string; nome: string }[] | undefined) || [];
  return {
    alerta_id: a.id,
    regra: a.regra,
    confianca: a.confianca,
    status: a.status,
    envolvidos: envolvidos.map((c) => c.nome).join(", "),
    explicacao: a.explicacao,
    criado_em: a.criado_em,
  };
}

function linhasMetricas(m: Metrics): Record<string, unknown>[] {
  const linhas: { indicador: string; valor: unknown }[] = [
    { indicador: "taxa_transbordo_pct", valor: m.taxa_transbordo_pct },
    { indicador: "total_sessoes", valor: m.total_sessoes },
    { indicador: "total_transbordos", valor: m.total_transbordos },
    { indicador: "total_mensagens", valor: m.total_mensagens },
    { indicador: "disponibilidade_slo_pct", valor: m.disponibilidade_slo_pct },
    { indicador: "nps_ia_media", valor: m.nps.ia.media },
    { indicador: "nps_ia_indice", valor: m.nps.ia.indice },
    { indicador: "nps_ia_respostas", valor: m.nps.ia.respostas },
    { indicador: "nps_atendente_media", valor: m.nps.atendente.media },
    { indicador: "nps_atendente_indice", valor: m.nps.atendente.indice },
    { indicador: "nps_atendente_respostas", valor: m.nps.atendente.respostas },
  ];
  for (const [k, v] of Object.entries(m.sessoes_por_estado)) linhas.push({ indicador: `sessoes_estado_${k}`, valor: v });
  for (const [k, v] of Object.entries(m.tom_emocional)) linhas.push({ indicador: `tom_${k}`, valor: v });
  for (const [k, v] of Object.entries(m.sessoes_por_canal)) linhas.push({ indicador: `sessoes_canal_${k}`, valor: v });
  return linhas;
}

// Exporta todo o painel num único .zip com um CSV por conjunto de dados.
export async function exportarBriefingZip(dados: {
  sessoes: SessaoResumo[];
  fila: Briefing[];
  metrics: Metrics | null;
}) {
  // Carregado sob demanda para não pesar no bundle inicial do painel.
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("sessoes.csv", comBom(linhasParaCsv(dados.sessoes.map(linhaSessao))));
  zip.file("fila-transbordo.csv", comBom(linhasParaCsv(dados.fila.map(linhaBriefing))));

  try {
    const clientes = await civ.clientesBuscar({ limit: 500 });
    zip.file(
      "clientes.csv",
      comBom(
        linhasParaCsv(
          clientes.map((c) => ({
            cliente_id: c.id,
            nome: c.nome,
            tipo_cliente: c.tipo_cliente,
            data_cadastro: c.data_cadastro,
            total_sessoes: c.total_sessoes,
            total_transbordos: c.total_transbordos,
            ultima_interacao: c.ultima_interacao ?? "",
          }))
        )
      )
    );
  } catch {
    zip.file("clientes.csv", comBom("erro;ao;carregar;clientes"));
  }

  if (dados.metrics) zip.file("metricas.csv", comBom(linhasParaCsv(linhasMetricas(dados.metrics))));

  // Alertas de fraude — exclusivo do admin no backend (mesmo RBAC da aba
  // Fraude); se quem exportou for atendente, a chamada volta 403 e o
  // arquivo simplesmente não entra no zip, sem quebrar o resto da exportação.
  try {
    const alertas = await fraude.alertas();
    zip.file("alertas-fraude.csv", comBom(linhasParaCsv(alertas.map(linhaAlertaFraude))));
  } catch {
    // sem permissão (atendente) ou motor de fraude indisponível — ignora.
  }

  const blob = await zip.generateAsync({ type: "blob" });
  baixarBlob(blob, `vox-briefing-${carimboArquivo()}.zip`);
}

// ---------------------------------------------------------------------------
// PDF da conversa (transcrição já anonimizada pelo backend)
// ---------------------------------------------------------------------------

function rotuloRemetente(r: string): string {
  return r === "cliente" ? "Cliente" : r === "atendente" ? "Atendente" : "Vox (IA)";
}

export async function exportarConversaPdf(sessaoId: string) {
  const t: Transcript = await civ.sessionTranscript(sessaoId);
  // Carregado sob demanda — jsPDF é grande e só é usado nesta ação.
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const margem = 48;
  const larguraUtil = doc.internal.pageSize.getWidth() - margem * 2;
  const alturaPagina = doc.internal.pageSize.getHeight();
  let y = 56;

  const quebrarSeNecessario = (altura: number) => {
    if (y + altura > alturaPagina - 56) {
      doc.addPage();
      y = 56;
    }
  };
  const paragrafo = (texto: string, alturaLinha = 12) => {
    const linhas = doc.splitTextToSize(texto, larguraUtil) as string[];
    quebrarSeNecessario(linhas.length * alturaLinha + 4);
    doc.text(linhas, margem, y);
    y += linhas.length * alturaLinha + 4;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Claro Vox · Transcrição de atendimento", margem, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text("Documento anonimizado: dados pessoais do cliente removidos (LGPD).", margem, y);
  y += 22;
  doc.setTextColor(20);

  doc.setFontSize(10);
  const canalLabel = CANAL_META[t.sessao.canal || ""]?.label || t.sessao.canal || "—";
  const estadoLabel = ESTADO_META[t.sessao.estado]?.label || t.sessao.estado;
  const tomLabel = t.tom_predominante
    ? TOM_META[t.tom_predominante]?.label || t.tom_predominante
    : "—";
  for (const linha of [
    `Sessão: ${t.sessao.id}`,
    `Canal: ${canalLabel}`,
    `Estado: ${estadoLabel}`,
    `Início: ${fmtDataHora(t.sessao.criado_em)}`,
    `Última atualização: ${fmtDataHora(t.sessao.atualizado_em)}`,
    `Tipo de cliente: ${t.cliente.tipo_cliente || "—"}`,
    `Tom predominante: ${tomLabel}`,
  ]) {
    doc.text(linha, margem, y);
    y += 14;
  }
  y += 10;

  if (t.briefing) {
    doc.setFont("helvetica", "bold");
    quebrarSeNecessario(18);
    doc.text("Briefing de transbordo", margem, y);
    y += 15;
    doc.setFont("helvetica", "normal");
    paragrafo(`Motivo: ${t.briefing.motivo_transbordo || "—"}`);
    paragrafo(`Resumo da jornada: ${t.briefing.resumo_jornada || "—"}`);
    paragrafo(`Sugestão de resolução: ${t.briefing.sugestao_resolucao || "—"}`);
    y += 10;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  quebrarSeNecessario(20);
  doc.text("Conversa", margem, y);
  y += 16;
  doc.setFontSize(10);

  for (const m of t.mensagens) {
    const cabecalho = `${rotuloRemetente(m.remetente)} · ${fmtDataHora(m.timestamp)}`;
    const corpo = doc.splitTextToSize(m.conteudo || "—", larguraUtil) as string[];
    quebrarSeNecessario(14 + corpo.length * 12 + 10);
    doc.setFont("helvetica", "bold");
    doc.text(cabecalho, margem, y);
    y += 13;
    doc.setFont("helvetica", "normal");
    doc.text(corpo, margem, y);
    y += corpo.length * 12 + 12;
  }

  const totalPaginas = doc.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Claro Vox · gerado em ${fmtDataHora(new Date().toISOString())} · página ${i}/${totalPaginas}`,
      margem,
      alturaPagina - 28
    );
  }

  doc.save(`conversa-${sessaoId.slice(0, 8)}.pdf`);
}
