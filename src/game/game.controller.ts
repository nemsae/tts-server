import { Controller, Get, Post, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { TwisterGeneratorService } from './services/twister-generator.service.js';
import { RoomManagerService } from './services/room-manager.service.js';
import { GenerateTwistersDto } from './dto/game.dto.js';

@Controller('api')
export class GameController {
  private readonly logger = new Logger(GameController.name);

  constructor(
    private readonly twisterGenerator: TwisterGeneratorService,
    private readonly roomManager: RoomManagerService,
  ) {}

  @Get('lobby/active-players')
  getActivePlayers(): { count: number } {
    const count = this.roomManager.getActiveLobbyPlayerCount();
    return { count };
  }

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generateTwisters(@Body() dto: GenerateTwistersDto): Promise<{ twisters: unknown[] }> {
    try {
      const twisters = await this.twisterGenerator.generateTwisters(
        dto.topic,
        dto.length,
        dto.customLength,
        dto.rounds ?? 1,
      );
      this.logger.log(`Generated twisters via REST - topic: ${dto.topic}, length: ${dto.length}, rounds: ${dto.rounds}, count: ${twisters.length}`);
      return { twisters };
    } catch (error) {
      this.logger.error('Failed to generate twisters', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
