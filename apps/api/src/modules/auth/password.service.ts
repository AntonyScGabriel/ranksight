import { Injectable } from "@nestjs/common";
import { hashPassword, verifyPassword } from "./password-hash.js";

@Injectable()
export class PasswordService {
  /** Hash factice : la vérification prend le même temps, que le compte existe ou non. */
  private dummy?: Promise<string>;

  hash(password: string): Promise<string> {
    return hashPassword(password);
  }

  async verify(password: string, stored: string | null | undefined): Promise<boolean> {
    if (!stored) {
      this.dummy ??= hashPassword("compte-inexistant-0");
      await verifyPassword(password, await this.dummy);
      return false;
    }
    return verifyPassword(password, stored);
  }
}
