import { Module } from "@nestjs/common";
import { PromoModule } from "../promo/promo.module.js";
import { PlayController, SubmissionsController } from "./clips.controller.js";
import { ClipProcessingService } from "./clip-processing.service.js";
import { ClipRemovalService } from "./clip-removal.service.js";
import { ClipsService } from "./clips.service.js";
import { PlayTokenService } from "./play-token.service.js";
import { SubmissionsService } from "./submissions.service.js";

@Module({
  imports: [PromoModule],
  controllers: [PlayController, SubmissionsController],
  providers: [ClipsService, PlayTokenService, SubmissionsService, ClipRemovalService, ClipProcessingService],
  exports: [ClipsService, PlayTokenService, ClipRemovalService, ClipProcessingService],
})
export class ClipsModule {}
