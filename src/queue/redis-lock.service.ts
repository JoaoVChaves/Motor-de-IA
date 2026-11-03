
import {
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

@Injectable()
export class RedisLockService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(configService: ConfigService) {
    this.client = new Redis({
      host: configService.get<string>('REDIS_HOST', 'localhost'),
      port: configService.get<number>('REDIS_PORT', 6379),
      maxRetriesPerRequest: null,
    });
  }

  async adquirir(
    key: string,
    token: string,
    ttl: number,
  ): Promise<boolean> {
    const result = await this.client.set(
      key,
      token,
      'PX',
      ttl,
      'NX',
    );

    return result === 'OK';
  }

  async renovar(
    key: string,
    token: string,
    ttl: number,
  ): Promise<boolean> {
    const result = await this.client.eval(
      `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("PEXPIRE", KEYS[1], ARGV[2])
        end
        return 0
      `,
      1,
      key,
      token,
      ttl,
    );

    return result === 1;
  }

  async liberar(key: string, token: string): Promise<void> {
    await this.client.eval(
      `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        end
        return 0
      `,
      1,
      key,
      token,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
