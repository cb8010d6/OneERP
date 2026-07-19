import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class CreateQuoteVersionDto {
  @ApiPropertyOptional({
    description: '新版本有效期；未填写时沿用仍有效的当前版本，或顺延 14 天',
  })
  @IsOptional()
  @IsDateString()
  validUntil?: string;
}
