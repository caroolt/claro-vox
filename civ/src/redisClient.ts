import Redis from "ioredis";

export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const SESSION_TTL_SECONDS = 60 * 60 * 4; // 4h de TTL para o contexto ativo (RNF sugerido)

export async function cacheSessionContext(sessaoId: string, contexto: unknown) {
  await redis.set(`sessao:${sessaoId}:contexto`, JSON.stringify(contexto), "EX", SESSION_TTL_SECONDS);
}

export async function getCachedSessionContext(sessaoId: string) {
  const raw = await redis.get(`sessao:${sessaoId}:contexto`);
  return raw ? JSON.parse(raw) : null;
}

export async function invalidateSessionContext(sessaoId: string) {
  await redis.del(`sessao:${sessaoId}:contexto`);
}
