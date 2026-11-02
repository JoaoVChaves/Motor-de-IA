
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class MessageWebhookDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  message_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  tenant_id!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') : value,
  )
  @IsString()
  @Matches(/^\d{10,15}$/, {
    message: 'O telefone deve conter entre 10 e 15 dígitos.',
  })
  telefone!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  texto!: string;

  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @IsOptional()
  @IsIn(['lead', 'humano'])
  autor: 'lead' | 'humano' = 'lead';

  @IsOptional()
  @IsBoolean()
  simulacao = false;
}
