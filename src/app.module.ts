import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

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
  ],
  controllers: [HealthController, AppController],
  providers: [AppService]
})
export class AppModule {}
