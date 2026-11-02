
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Res,
} from '@nestjs/common';
import { MessageWebhookDto } from './dto/message-webhook.dto.js';
import { WebhookService } from './webhook.service.js';

@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
  ) {}

  @Post('mensagem')
  @HttpCode(202)
  async receberMensagem(
    @Body() dto: MessageWebhookDto,
    @Headers('x-simulacao') simulacaoHeader: string | undefined,
    @Res({ passthrough: true })
    response: { status: (code: number) => unknown },
  ) {
    let simulacao = dto.simulacao;

    if (simulacaoHeader !== undefined) {
      if (!['true', 'false'].includes(simulacaoHeader)) {
        throw new BadRequestException(
          'O header x-simulacao deve ser true ou false.',
        );
      }

      simulacao = simulacaoHeader === 'true';
    }

    const resultado = await this.webhookService.receberMensagem({
      ...dto,
      simulacao,
    });

    if (resultado.idempotent_duplicate) {
      response.status(200);
    }

    return resultado;
  }
}
