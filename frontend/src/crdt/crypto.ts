function b64uEncode(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

export function randomKeyB64u(): string {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return b64uEncode(key);
}

export async function importRoomKey(keyB64u: string): Promise<CryptoKey> {
  // Copy into an ArrayBuffer-backed view. TypeScript's DOM definitions reject
  // a generic ArrayBufferLike here because it could be a SharedArrayBuffer.
  const raw = Uint8Array.from(b64uDecode(keyB64u));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(key: CryptoKey, plaintext: Uint8Array): Promise<{ ivB64: string; ctB64: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const input = Uint8Array.from(plaintext);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, input));
  return { ivB64: b64uEncode(iv), ctB64: b64uEncode(ct) };
}

export async function decrypt(key: CryptoKey, ivB64: string, ctB64: string): Promise<Uint8Array> {
  const iv = Uint8Array.from(b64uDecode(ivB64));
  const ct = Uint8Array.from(b64uDecode(ctB64));
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
  return pt;
}
