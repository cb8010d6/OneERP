import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { TaxNature } from '@prisma/client';

export class CreateTaxCodeDto {
  @ApiProperty({ description: '税码编码，如 VAT_13、GST_5' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ description: '税码名称' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: '税率 (0-1)', example: 0.13 })
  @IsNumber()
  @Min(0)
  @Max(1)
  rate!: number;

  @ApiProperty({ description: '是否含税计价', default: true })
  @IsOptional()
  @IsBoolean()
  isTaxInclusive?: boolean;

  @ApiProperty({ description: '设置为公司默认税码', default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({
    description: '税务属性: OUTPUT=销项税, INPUT=进项税',
    enum: TaxNature,
    default: TaxNature.OUTPUT,
  })
  @IsOptional()
  @IsEnum(TaxNature)
  taxNature?: TaxNature;

  @ApiPropertyOptional({ description: '（旧）税务科目 ID' })
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional({ description: '销项税科目 ID' })
  @IsOptional()
  @IsString()
  outputAccountId?: string;

  @ApiPropertyOptional({ description: '进项税科目 ID' })
  @IsOptional()
  @IsString()
  inputAccountId?: string;
}

export class UpdateTaxCodeDto {
  @ApiPropertyOptional({ description: '税码名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '税率 (0-1)', example: 0.13 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  rate?: number;

  @ApiPropertyOptional({ description: '是否含税计价' })
  @IsOptional()
  @IsBoolean()
  isTaxInclusive?: boolean;

  @ApiPropertyOptional({ description: '是否默认税码' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: '税务属性', enum: TaxNature })
  @IsOptional()
  @IsEnum(TaxNature)
  taxNature?: TaxNature;

  @ApiPropertyOptional({ description: '销项税科目 ID' })
  @IsOptional()
  @IsString()
  outputAccountId?: string;

  @ApiPropertyOptional({ description: '进项税科目 ID' })
  @IsOptional()
  @IsString()
  inputAccountId?: string;

  @ApiPropertyOptional({ description: '（旧）税务科目 ID' })
  @IsOptional()
  @IsString()
  accountId?: string;
}
