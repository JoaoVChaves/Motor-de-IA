
import { IsIn, IsNotEmpty, IsString, Matches } from 'class-validator';

export class InterventionDto {
  @IsString()
  @IsNotEmpty()
  tenant_id!: string;

  @IsString()
  @Matches(/^\d{10,15}$/, {
    message: 'O telefone deve conter entre 10 e 15 dígitos.',
  })
  telefone!: string;

  @IsString()
  @IsIn(['assumir', 'religar'])
  acao!: 'assumir' | 'religar';
}
