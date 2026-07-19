import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateContractDto {
  @ApiProperty({ description: '合同标题' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ description: '合同生效日期' })
  @IsOptional()
  @IsDateString()
  effectiveAt?: string;

  @ApiPropertyOptional({ description: '合同到期日期' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
