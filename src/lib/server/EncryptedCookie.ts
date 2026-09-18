import type { RequestEvent } from "@sveltejs/kit";
import { Sealer } from "./Sealer";

export class EncryptedCookie {
  #name: string;
  #sealer: Sealer;

  private constructor(name: string, sealer: Sealer) {
    this.#name = name;
    this.#sealer = sealer;
  }

  static async create(name: string, secret: string): Promise<EncryptedCookie> {
    return new EncryptedCookie(name, await Sealer.create(secret, name));
  }

  async getValue(event: RequestEvent): Promise<string | null> {
    const cookie = event.cookies.get(this.#name);
    if (!cookie) {
      return null;
    }
    try {
      return await this.#sealer.open(cookie);
    } catch (err) {
      throw new Error("Unable to decrypt cookie: " + err);
    }
  }

  async setValue(
    event: RequestEvent,
    value: string,
    opts: import("cookie").CookieSerializeOptions & { path: string }
  ) {
    event.cookies.set(this.#name, await this.#sealer.seal(value), opts);
  }
}
