const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** AES-GCM over strings, with the key derived from a shared secret and a
 *  purpose. The same secret sealed for a different purpose gives a different
 *  key, so a value sealed for one cannot be opened as the other. */
export class Sealer {
  #key: CryptoKey;
  #aad: Uint8Array<ArrayBuffer>;

  private constructor(key: CryptoKey, purpose: string) {
    this.#key = key;
    this.#aad = encoder.encode(purpose);
  }

  static async create(secret: string, purpose: string): Promise<Sealer> {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      "HKDF",
      false,
      ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: encoder.encode("EncryptedCookie"),
        info: encoder.encode(purpose)
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    return new Sealer(key, purpose);
  }

  async seal(value: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: this.#aad },
      this.#key,
      encoder.encode(value)
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return Buffer.from(combined).toString("base64");
  }

  async open(sealed: string): Promise<string> {
    const combined = Buffer.from(sealed, "base64");
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: combined.subarray(0, 12), additionalData: this.#aad },
      this.#key,
      combined.subarray(12)
    );
    return decoder.decode(decrypted);
  }
}
