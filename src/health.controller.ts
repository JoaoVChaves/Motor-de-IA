
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'motor-ia-atendimento-hot-reload-final',
      timestamp: new Date().toISOString(),
    };
  }
}
