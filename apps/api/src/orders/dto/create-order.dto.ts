import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsOptional,
  Max,
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

  @ApiPropertyOptional({
    description: '请求折扣（百分比，支持 0.15 或 15 表示 15%）',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  requestedDiscount?: number;

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
  @ArrayMinSize(1, { message: '订单明细不能为空' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @ApiPropertyOptional({
    description: '订单税码ID (建议填写，未填将使用默认税码)',
  })
  @IsOptional()
  @IsString()
  taxCodeId?: string;

  @ApiPropertyOptional({ description: '需求识别摘要' })
  @IsOptional()
  aiSummary?: Record<string, unknown>;
}

export class UpdateOrderDto {
  @ApiPropertyOptional({ description: '伙伴ID（客户）' })
  @IsOptional()
  @IsString()
  partnerId?: string;

  @ApiPropertyOptional({ description: '预计交付日期' })
  @IsOptional()
  expectedDate?: string | Date | null;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class UpdateOrderItemsDto {
  @ApiProperty({ description: '订单项列表', type: [OrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}
