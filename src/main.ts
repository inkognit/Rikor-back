import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, configureSwagger, SWAGGER_PATH } from './app.setup';
import { WinstonLogger } from './core/winston.logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(WinstonLogger));
  app.enableShutdownHooks();
  configureApp(app);

  const config = app.get(ConfigService);
  // Вне прода: документация не должна светиться на публичном сервере.
  const swaggerEnabled = config.getOrThrow<string>('NODE_ENV') !== 'production';
  if (swaggerEnabled) {
    configureSwagger(app);
  }

  const host = config.getOrThrow<string>('HOST');
  const port = config.getOrThrow<number>('PORT');
  await app.listen(port, host);

  const log = new Logger('Bootstrap');
  log.log(`API: http://${host}:${port}`);
  if (swaggerEnabled) {
    log.log(`Swagger: http://${host}:${port}/${SWAGGER_PATH}`);
  }
}

void bootstrap();
