import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway.js';
import { GameController } from './game.controller.js';
import { GameEngineService, TwisterGeneratorService } from './services/index.js';
import { SpacetimeDBService } from './services/spacetimedb.service.js';

@Module({
  controllers: [GameController],
  providers: [GameGateway, GameEngineService, TwisterGeneratorService, SpacetimeDBService],
  exports: [GameEngineService, TwisterGeneratorService, SpacetimeDBService],
})
export class GameModule {}
