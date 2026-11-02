
import { Body, Controller, Post } from '@nestjs/common';
import { InterventionDto } from './dto/intervention.dto.js';
import { InterventionService } from './intervention.service.js';

@Controller('intervencao')
export class InterventionController {
  constructor(
    private readonly interventionService: InterventionService,
  ) {}

  @Post()
  async executar(@Body() dto: InterventionDto) {
    return this.interventionService.executar(dto);
  }
}
