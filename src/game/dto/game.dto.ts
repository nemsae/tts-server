import { IsString, IsNumber, IsOptional, IsIn, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class GameSettingsDto {
  @IsString()
  topic: string;

  @IsIn(['short', 'medium', 'long', 'custom'])
  length: 'short' | 'medium' | 'long' | 'custom';

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(20)
  customLength?: number;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(10)
  rounds: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  roundTimeLimit?: number;

  @IsOptional()
  autoSubmitEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  autoSubmitDelay?: number;
}

export class CreateRoomDto {
  @IsString()
  playerName: string;

  @ValidateNested()
  @Type(() => GameSettingsDto)
  settings: GameSettingsDto;
}

export class JoinRoomDto {
  @IsString()
  roomCode: string;

  @IsString()
  playerName: string;
}

export class SubmitAnswerDto {
  @IsString()
  transcript: string;

  @IsNumber()
  @Type(() => Number)
  timestamp: number;
}

export class GenerateTwistersDto {
  @IsString()
  topic: string;

  @IsIn(['short', 'medium', 'long', 'custom'])
  length: 'short' | 'medium' | 'long' | 'custom';

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(20)
  customLength?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(10)
  rounds?: number;
}
