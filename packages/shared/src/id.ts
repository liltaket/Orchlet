import { randomBytes, randomUUID } from "node:crypto";

export function generateId(prefix?: string): string {
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  return prefix ? `${prefix}_${id}` : id;
}

export function generateShortId(length = 8): string {
  return randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}
