import geoip from "geoip-lite";

export interface LocalizacaoIp {
  cidade: string | null;
  regiao: string | null;
  pais: string | null;
}

// Geolocalização real a partir do IP via base MaxMind GeoLite2 embutida no
// geoip-lite (offline, sem chamada externa/chave de API). IPs privados/de
// rede local (127.0.0.1, 192.168.x.x etc., comuns em ambiente de
// desenvolvimento) não têm registro público de geolocalização — devolve
// null nesse caso, igual a qualquer serviço de geoIP real.
export function localizarIp(ip: string | null | undefined): LocalizacaoIp | null {
  if (!ip) return null;
  // Normaliza o prefixo IPv4-mapeado-em-IPv6 (::ffff:1.2.3.4), que
  // servidores HTTP às vezes reportam em conexões IPv4 — sem isso
  // geoip-lite não reconhece o endereço.
  const r = geoip.lookup(ip.replace(/^::ffff:/, ""));
  if (!r) return null;
  return {
    cidade: r.city || null,
    regiao: r.region || null,
    pais: r.country || null,
  };
}

export function formatarLocalizacao(loc: LocalizacaoIp | null): string | null {
  if (!loc) return null;
  const partes = [loc.cidade, loc.regiao, loc.pais].filter(Boolean);
  return partes.length ? partes.join(", ") : null;
}
