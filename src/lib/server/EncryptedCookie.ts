import type { RequestEvent } from "@sveltejs/kit";

export class EncryptedCookie {
  #name: string;
  #key: CryptoKey;
  static #encoder: TextEncoder = new TextEncoder();
  static #decoder: TextDecoder = new TextDecoder();

  constructor(name: string, key: CryptoKey) {
    this.#name = name;
    this.#key = key;
  }

  static async createKey(secret: string, name: string): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      EncryptedCookie.#encoder.encode(secret),
      "HKDF",
      false,
      ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: EncryptedCookie.#encoder.encode("EncryptedCookie"),
        info: EncryptedCookie.#encoder.encode(name)
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async getValue(event: RequestEvent): Promise<string | null> {
    const cookie = event.cookies.get(this.#name);
    if (!cookie) {
      return null;
    }
    try {
      return await this.#decrypt(cookie);
    } catch (err) {
      throw new Error("Unable to decrypt cookie: " + err);
    }
  }

  async setValue(
    event: RequestEvent,
    value: string,
    opts: import("cookie").CookieSerializeOptions & { path: string }
  ) {
    const encryptedValue = await this.#encrypt(value);

    event.cookies.set(this.#name, encryptedValue, opts);
  }

  async #encrypt(value: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
    const data = EncryptedCookie.#encoder.encode(value);

    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
        additionalData: EncryptedCookie.#encoder.encode(this.#name)
      },
      this.#key,
      data
    );

    // Combine iv + ciphertext
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    return Buffer.from(combined).toString("base64");
  }

  async #decrypt(value: string): Promise<string> {
    const combined = Buffer.from(value, "base64");
    const iv = combined.subarray(0, 12);
    const ciphertext = combined.subarray(12);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
        additionalData: EncryptedCookie.#encoder.encode(this.#name)
      },
      this.#key,
      ciphertext
    );

    return EncryptedCookie.#decoder.decode(decrypted);
  }
}
