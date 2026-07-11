import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRequirementDto {
  @ApiProperty({ description: '客户 Partner ID' })
  @IsString()
  @IsNotEmpty()
  partnerId!: string;

  @ApiProperty({ description: '需求来源渠道' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sourceChannel!: string;

  @ApiProperty({ description: '客户需求摘要' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  summary!: string;

  @ApiPropertyOptional({ description: '预计金额' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  estimatedAmount?: number;

  @ApiPropertyOptional({ description: '预计成交日期' })
  @IsOptional()
  @IsDateString()
  expectedCloseDate?: string;

  @ApiPropertyOptional({ description: '下一次跟进时间' })
  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string;
}
