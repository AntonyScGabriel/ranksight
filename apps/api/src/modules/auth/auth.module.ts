import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { MfaService } from "./mfa.service.js";
import { OAuthService } from "./oauth.service.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";

@Module({
  controllers: [AuthController],
  providers: [AuthService, OAuthService, TokenService, PasswordService, MfaService],
  exports: [TokenService, MfaService, AuthService],
})
export class AuthModule {}
