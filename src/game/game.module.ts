import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway.js';
import { GameController } from './game.controller.js';
import { GameEngineService, RoomManagerService, TwisterGeneratorService } from './services/index.js';
import { SpacetimeDBService } from './services/spacetimedb.service.js';

@Module({
  controllers: [GameController],
  providers: [GameGateway, GameEngineService, RoomManagerService, TwisterGeneratorService, SpacetimeDBService],
  exports: [GameEngineService, RoomManagerService, TwisterGeneratorService, SpacetimeDBService],
})
export class GameModule {}
