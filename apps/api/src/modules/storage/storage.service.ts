import { Injectable } from "@nestjs/common";
import {
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "../../config/env.js";
import { CLIP_MAX_BYTES, CLIP_MAX_MB } from "@ranksight/shared";

const ALLOWED_TYPES = { "video/mp4": "mp4", "video/webm": "webm", "image/webp": "webp", "image/jpeg": "jpg" } as const;
export type UploadContentType = keyof typeof ALLOWED_TYPES;
export const MAX_UPLOAD_BYTES = CLIP_MAX_BYTES; // 1 minute en 1080p

/** Clé de stockage valide : dossier connu + UUID + extension autorisée (bloque toute traversée de chemin). */
export const KEY_PATTERN = /^(raw|clips|hls|posters|avatars)\/[0-9a-f-]{36}\.(mp4|webm|webp|jpg)$/;
/** Dossiers du stockage : envois bruts, vidéos compressées, images d'aperçu, photos de profil */
export const STORAGE_FOLDERS = ["raw", "clips", "hls", "posters", "avatars"] as const;

export interface StoredObject { key: string; size: number; lastModified: Date }

/**
 * Deux pilotes, même interface :
 * - "s3"    : Cloudflare R2 en production, upload direct navigateur → R2 par URL présignée.
 * - "local" : développement sans service externe ; l'API stocke les fichiers sur disque
 *             et les sert via des URL signées HMAC (même principe que les URL présignées S3).
 * Les clés sont aléatoires et ne révèlent JAMAIS le rang (pas de "valorant/diamond/clip.mp4").
 */
@Injectable()
export class StorageService {
  private readonly driver = env().STORAGE_DRIVER;
  private readonly s3 =
    this.driver === "s3"
      ? new S3Client({
          region: env().S3_REGION,
          endpoint: env().S3_ENDPOINT,
          forcePathStyle: true,
          // Sans ça, le SDK ajoute une somme de contrôle aux URL présignées et l'upload navigateur échoue (R2)
          requestChecksumCalculation: "WHEN_REQUIRED",
          responseChecksumValidation: "WHEN_REQUIRED",
          credentials: { accessKeyId: env().S3_ACCESS_KEY_ID, secretAccessKey: env().S3_SECRET_ACCESS_KEY },
        })
      : null;

  /** URL d'upload direct depuis le navigateur, valable 10 min. */
  async createUploadUrl(contentType: UploadContentType, sizeBytes: number) {
    if (!(contentType in ALLOWED_TYPES)) throw new Error("Type de fichier refusé");
    if (sizeBytes > MAX_UPLOAD_BYTES) throw new Error(`Fichier trop volumineux (${CLIP_MAX_MB} Mo max)`);
    const key = `raw/${randomUUID()}.${ALLOWED_TYPES[contentType]}`;
    if (this.s3) {
      const url = await getSignedUrl(
        this.s3,
        new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, ContentType: contentType, ContentLength: sizeBytes }),
        { expiresIn: 600 },
      );
      return { key, url };
    }
    return { key, url: this.localUrl("PUT", key, 600, contentType) };
  }

  /** URL de lecture valable 10 min : suffisant pour regarder, inutile à partager ou aspirer. */
  async signedReadUrl(key: string, ttlSec = 600) {
    if (this.s3) {
      return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }), { expiresIn: ttlSec });
    }
    return this.localUrl("GET", key, ttlSec);
  }

  // ---------- Fichiers (compression, nettoyage) ----------

  /** Le fichier existe-t-il ? (vérification après l'envoi direct du navigateur) */
  async exists(key: string): Promise<boolean> {
    if (!KEY_PATTERN.test(key)) return false;
    if (this.s3) {
      try {
        await this.s3.send(new HeadObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
        return true;
      } catch {
        return false;
      }
    }
    return stat(this.localPath(key)).then((s) => s.isFile(), () => false);
  }

  /** Copie locale d'un fichier stocké (pour le traiter avec ffmpeg). */
  async download(key: string, dest: string) {
    if (this.s3) {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
      await pipeline(res.Body as Readable, createWriteStream(dest));
      return;
    }
    await copyFile(this.localPath(key), dest);
  }

  /** Enregistre un fichier local dans le stockage. */
  async upload(key: string, file: string, contentType: string) {
    if (!KEY_PATTERN.test(key)) throw new Error("Clé invalide");
    if (this.s3) {
      const { size } = await stat(file);
      await this.s3.send(new PutObjectCommand({
        Bucket: env().S3_BUCKET, Key: key, Body: createReadStream(file), ContentType: contentType, ContentLength: size,
      }));
      return;
    }
    await mkdir(path.dirname(this.localPath(key)), { recursive: true });
    await copyFile(file, this.localPath(key));
  }

  /** Enregistre un contenu en mémoire (image déjà traitée) dans le stockage. */
  async uploadBuffer(key: string, body: Buffer, contentType: string) {
    if (!KEY_PATTERN.test(key)) throw new Error("Clé invalide");
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, Body: body, ContentType: contentType, ContentLength: body.length }));
      return;
    }
    await mkdir(path.dirname(this.localPath(key)), { recursive: true });
    await writeFile(this.localPath(key), body);
  }

  /** Lecture d'un fichier stocké (null s'il n'existe pas), pour le servir par l'API. */
  async read(key: string): Promise<Readable | null> {
    if (!KEY_PATTERN.test(key)) return null;
    if (this.s3) {
      try {
        const res = await this.s3.send(new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
        return res.Body as Readable;
      } catch {
        return null;
      }
    }
    const file = this.localPath(key);
    return (await stat(file).then((s) => s.isFile(), () => false)) ? createReadStream(file) : null;
  }

  async delete(key: string) {
    if (!KEY_PATTERN.test(key)) return;
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
      return;
    }
    await rm(this.localPath(key), { force: true });
  }

  /** Tous les fichiers du stockage (taille et date), dossier par dossier. */
  async list(): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    for (const folder of STORAGE_FOLDERS) {
      if (this.s3) {
        let token: string | undefined;
        do {
          const res = await this.s3.send(new ListObjectsV2Command({ Bucket: env().S3_BUCKET, Prefix: `${folder}/`, ContinuationToken: token }));
          for (const o of res.Contents ?? []) {
            if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified ?? new Date(0) });
          }
          token = res.IsTruncated ? res.NextContinuationToken : undefined;
        } while (token);
        continue;
      }
      const dir = path.resolve(env().LOCAL_STORAGE_DIR, folder);
      const files = await readdir(dir).catch(() => [] as string[]);
      for (const f of files) {
        const key = `${folder}/${f}`;
        // Envois interrompus (.part) : comptés aussi, ils sont nettoyés comme les fichiers orphelins
        const st = await stat(path.join(dir, f)).catch(() => null);
        if (st?.isFile()) out.push({ key, size: st.size, lastModified: st.mtime });
      }
    }
    return out;
  }

  /** Suppression d'un fichier local qui ne suit pas le format des clés (envoi interrompu). */
  async deleteLocalLeftover(key: string) {
    if (this.s3) return;
    const [folder, file] = key.split("/");
    if (!STORAGE_FOLDERS.includes(folder as (typeof STORAGE_FOLDERS)[number]) || !file || file.includes("..") || file.includes("/")) return;
    await rm(path.resolve(env().LOCAL_STORAGE_DIR, folder, file), { force: true });
  }

  get driverName() {
    return this.driver;
  }

  // ---------- Pilote local ----------

  private sign(method: string, key: string, exp: number, contentType = "") {
    return createHmac("sha256", env().JWT_ACCESS_SECRET).update(`${method}\n${key}\n${exp}\n${contentType}`).digest("base64url");
  }

  private localUrl(method: "GET" | "PUT", key: string, ttlSec: number, contentType = "") {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const sig = this.sign(method, key, exp, contentType);
    // Adresse relative : le client la complète avec l'adresse qu'il utilise déjà pour joindre l'API
    return `/v1/storage/${key}?exp=${exp}&sig=${sig}`;
  }

  verifyLocal(method: "GET" | "PUT", key: string, exp: string, sig: string, contentType = ""): boolean {
    if (this.driver !== "local" || !KEY_PATTERN.test(key)) return false;
    const expNum = Number(exp);
    if (!Number.isInteger(expNum) || expNum < Date.now() / 1000) return false;
    const expected = Buffer.from(this.sign(method, key, expNum, contentType));
    const given = Buffer.from(String(sig));
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  localPath(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error("Clé invalide");
    return path.resolve(env().LOCAL_STORAGE_DIR, key);
  }
}
