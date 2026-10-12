import { Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, PayloadTooLargeException, Put, Query, Req, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { Public } from "../../common/decorators/public.decorator.js";
import { MAX_UPLOAD_BYTES, StorageService } from "./storage.service.js";
import { CLIP_MAX_MB } from "@ranksight/shared";

/**
 * Pilote "local" uniquement : reçoit les uploads et sert les vidéos.
 * L'accès est contrôlé par la signature HMAC de l'URL (comme une URL présignée S3), pas par le JWT.
 * Avec STORAGE_DRIVER=s3, toutes ces routes répondent 403.
 */
@Controller("storage")
@SkipThrottle()
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Put(":folder/:file")
  @HttpCode(200)
  async upload(
    @Param("folder") folder: string,
    @Param("file") file: string,
    @Query("exp") exp: string,
    @Query("sig") sig: string,
    @Req() req: Request,
  ) {
    const key = `${folder}/${file}`;
    const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim();
    if (!this.storage.verifyLocal("PUT", key, exp, sig, contentType)) throw new ForbiddenException("Signature invalide ou expirée");

    const target = this.storage.localPath(key);
    const tmp = `${target}.part`;
    await mkdir(path.dirname(target), { recursive: true });

    let received = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        cb(received > MAX_UPLOAD_BYTES ? new PayloadTooLargeException(`Fichier trop volumineux (${CLIP_MAX_MB} Mo max)`) : null, chunk);
      },
    });
    try {
      await pipeline(req, limit, createWriteStream(tmp));
      await rename(tmp, target);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    return { key, size: received };
  }

  @Public()
  @Get(":folder/:file")
  serve(
    @Param("folder") folder: string,
    @Param("file") file: string,
    @Query("exp") exp: string,
    @Query("sig") sig: string,
    @Res() res: Response,
  ) {
    const key = `${folder}/${file}`;
    if (!this.storage.verifyLocal("GET", key, exp, sig)) throw new ForbiddenException("Signature invalide ou expirée");
    const target = this.storage.localPath(key);
    if (!existsSync(target)) throw new NotFoundException();
    // La vidéo est lue depuis le site (autre port) : helmet bloque ça par défaut
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "private, max-age=600");
    res.sendFile(target); // gère les requêtes Range (avance rapide dans la vidéo)
  }
}
