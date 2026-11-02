
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import Joi from 'joi';
import { HealthController } from './health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { ToolExecutorModule } from './tool-executor/tool-executor.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),

        PORT: Joi.number().default(3000),

        DATABASE_URL: Joi.string().required(),

        REDIS_HOST: Joi.string().default('localhost'),

        REDIS_PORT: Joi.number().default(6379),
      }),
    }),
    PrismaModule,
    TenantsModule,
    ToolExecutorModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
