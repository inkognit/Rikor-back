import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppExceptionFilter } from './common/app-exception.filter';
import { ResponseInterceptor } from './common/response.interceptor';

export const SWAGGER_PATH = 'docs';

/** Общая конфигурация для main.ts и e2e: тесты проверяют то же, что работает в запуске. */
export function configureApp(app: INestApplication): INestApplication {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: 422,
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AppExceptionFilter());
  return app;
}

/** Swagger UI: /docs, JSON-схема: /docs-json. */
export function configureSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Rikor Assistant API')
    .setDescription('Backend с LLM-агентом, который запоминает предпочтения пользователя.')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup(SWAGGER_PATH, app, () => SwaggerModule.createDocument(app, config));
}
