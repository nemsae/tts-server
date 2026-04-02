import { Logger } from '@nestjs/common';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: app.get(ConfigService).get<string>('CLIENT_URL'),
    credentials: true,
  });

  const port = app.get(ConfigService).get<number>('PORT') || 3001;
  await app.listen(port);
  logger.log(`Application running on port ${port}`);
}

void bootstrap();
