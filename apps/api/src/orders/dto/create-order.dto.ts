import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsArray,
  ValidateNested,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrderItemDto {
  @ApiProperty({ description: '产品ID' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ description: '数量' })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: '单价' })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ description: '税码ID (建议填写，未填将使用默认税码)' })
  @IsOptional()
  @IsString()
  taxCodeId?: string;
}

export class CreateOrderDto {
  @ApiProperty({ description: '伙伴ID（客户）' })
  @IsString()
  @IsNotEmpty()
  partnerId!: string;

  @ApiProperty({ description: '订单项列表', type: [OrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @ApiPropertyOptional({ description: '订单税码ID (建议填写，未填将使用默认税码)' })
  @IsOptional()
  @IsString()
  taxCodeId?: string;

  @ApiPropertyOptional({ description: '需求识别摘要' })
  @IsOptional()
  aiSummary?: Record<string, unknown>;
}
