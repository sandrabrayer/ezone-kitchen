/**
 * Small, dependency-free id generator. Uses crypto.randomUUID when available
 * (browsers and modern Node) and falls back to a timestamp+random string.
 */
export function newId(prefix = ''): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  const uuid =
    g.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return prefix ? `${prefix}_${uuid}` : uuid
}
