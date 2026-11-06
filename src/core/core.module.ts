import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { envSchema } from './env.schema';
import { WinstonLogger } from './winston.logger';

/** Единый источник инфраструктуры: бизнес-модули не импортируют ConfigModule сами. */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      validationSchema: envSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
  ],
  providers: [
    {
      provide: WinstonLogger,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new WinstonLogger({
          directory: config.getOrThrow<string>('LOG_DIR'),
          level: config.getOrThrow<string>('LOG_LEVEL'),
        }),
    },
  ],
  exports: [ConfigModule, WinstonLogger],
})
export class CoreModule {}
