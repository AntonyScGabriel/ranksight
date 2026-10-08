import { Controller, Get, Injectable, Module, NotFoundException, Param } from "@nestjs/common";
import { Public } from "../../common/decorators/public.decorator.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { RankIconsAdminController, RankIconsController } from "./rank-icons.js";

@Injectable()
export class GamesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.game.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: { ranks: { orderBy: { order: "asc" } } },
    });
  }

  async bySlug(slug: string) {
    const game = await this.prisma.game.findUnique({
      where: { slug },
      include: { ranks: { orderBy: { order: "asc" } } },
    });
    if (!game || !game.isActive) throw new NotFoundException();
    return game;
  }
}

@Controller("games")
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Public()
  @Get()
  list() {
    return this.games.list();
  }

  @Public()
  @Get(":slug")
  get(@Param("slug") slug: string) {
    return this.games.bySlug(slug);
  }
}

@Module({ controllers: [GamesController, RankIconsController, RankIconsAdminController], providers: [GamesService], exports: [GamesService] })
export class GamesModule {}
