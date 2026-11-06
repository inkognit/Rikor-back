import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { HealthModule } from './modules/health/health.module';

@Module({ imports: [CoreModule, HealthModule, AssistantModule] })
export class AppModule {}
