import { Controller, Get, Post, Body, HttpCode, HttpStatus, Logger, UsePipes } from '@nestjs/common';
import { TwisterGeneratorService } from './services/twister-generator.service.js';
import { SpacetimeDBService } from './services/spacetimedb.service.js';
import { GenerateTwistersSchema, type GenerateTwistersDto } from './dto/game.dto.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

@Controller('api')
export class GameController {
  private readonly logger = new Logger(GameController.name);

  constructor(
    private readonly twisterGenerator: TwisterGeneratorService,
    private readonly spacetimeDb: SpacetimeDBService,
  ) {}

  @Get('lobby/active-players')
  async getActivePlayers(): Promise<{ count: number }> {
    const count = await this.spacetimeDb.getActiveLobbyPlayerCount();
    return { count };
  }

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(GenerateTwistersSchema))
  async generateTwisters(@Body() dto: GenerateTwistersDto): Promise<{ twisters: unknown[] }> {
    try {
      const twisters = await this.twisterGenerator.generateTwisters(
        dto.topic,
        dto.length,
        dto.customLength,
        dto.rounds ?? 1,
      );
      this.logger.log(
        `Generated twisters via REST - topic: ${dto.topic}, length: ${dto.length}, rounds: ${dto.rounds}, count: ${twisters.length}`,
      );
      return { twisters };
    } catch (error) {
      this.logger.error('Failed to generate twisters', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
