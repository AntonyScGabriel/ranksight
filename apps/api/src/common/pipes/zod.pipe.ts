import { BadRequestException, PipeTransform } from "@nestjs/common";
import { z, type ZodType } from "zod";

/** Valide un body/query avec un schéma Zod partagé (@ranksight/shared). Les champs inconnus sont rejetés. */
export class ZodPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: result.error.issues[0]?.message ?? "Données invalides.",
        issues: z.flattenError(result.error),
      });
    }
    return result.data;
  }
}
