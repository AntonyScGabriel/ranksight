import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "isPublic";
/** Route accessible sans jeton. Si un jeton valide est fourni, `req.user` est tout de même renseigné. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
