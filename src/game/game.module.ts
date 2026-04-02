import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway.js';
import { GameController } from './game.controller.js';
import { GameEngineService, RoomManagerService, TwisterGeneratorService } from './services/index.js';

@Module({
  controllers: [GameController],
  providers: [GameGateway, GameEngineService, RoomManagerService, TwisterGeneratorService],
  exports: [GameEngineService, RoomManagerService, TwisterGeneratorService],
})
export class GameModule {}
