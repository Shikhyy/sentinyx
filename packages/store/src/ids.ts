import { randomBytes } from "node:crypto";

// Unambiguous lowercase alphabet (no 0/o/1/l/i). 10 chars ≈ 50 bits, enough to be unguessable.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function newId(len = 10): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export const ID_PATTERN = /^[2-9a-hjkmnp-z]{10}$/;
