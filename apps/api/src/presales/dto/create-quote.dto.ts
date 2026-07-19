import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateQuoteItemDto {
  @ApiProperty({ description: '产品 ID' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ description: '数量' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @ApiProperty({ description: '报价单价' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ description: '折扣率，0 到 1', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  discountRate?: number;

  @ApiPropertyOptional({ description: '税率，0 到 1', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  taxRate?: number;
}

export class CreateQuoteDto {
  @ApiProperty({ description: 'ISO 4217 交易币种；首批创建仅支持 CNY' })
  @IsString()
  @Length(3, 3)
  currencyCode!: string;

  @ApiProperty({ description: '报价有效期' })
  @IsDateString()
  validUntil!: string;

  @ApiProperty({ description: '报价明细', type: [CreateQuoteItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateQuoteItemDto)
  items!: CreateQuoteItemDto[];

  @ApiPropertyOptional({ description: '付款条款' })
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiPropertyOptional({ description: '交付条款' })
  @IsOptional()
  @IsString()
  deliveryTerms?: string;
}
