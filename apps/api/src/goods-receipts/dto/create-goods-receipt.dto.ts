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

// ---- 收货单明细行 DTO ----

export class GoodsReceiptLineDto {
  @ApiProperty({ description: '采购单行ID (PurchaseOrderLine.id)' })
  @IsString()
  @IsNotEmpty()
  orderLineId!: string;

  @ApiProperty({ description: '物料ID' })
  @IsString()
  @IsNotEmpty()
  materialId!: string;

  @ApiProperty({ description: '产品ID' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ description: '目标库位ID' })
  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @ApiProperty({ description: '收货数量' })
  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @ApiPropertyOptional({ description: '批次号' })
  @IsOptional()
  @IsString()
  batchNo?: string;
}

// ---- 创建收货单 DTO ----

export class CreateGoodsReceiptDto {
  @ApiProperty({ description: '关联采购单ID' })
  @IsString()
  @IsNotEmpty()
  purchaseOrderId!: string;

  @ApiProperty({ description: '供应商ID (Partner.id)' })
  @IsString()
  @IsNotEmpty()
  partnerId!: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    description: '收货单明细行',
    type: [GoodsReceiptLineDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines!: GoodsReceiptLineDto[];
}

// ---- 确认收货 DTO ----

export class ConfirmGoodsReceiptDto {
  @ApiPropertyOptional({ description: '确认备注' })
  @IsOptional()
  @IsString()
  note?: string;
}

// ---- 冲销收货单 DTO ----

export class ReverseGoodsReceiptDto {
  @ApiPropertyOptional({ description: '冲销备注' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description: '冲销出库来源库位ID（默认取原收货入库目标库位）',
  })
  @IsOptional()
  @IsString()
  sourceLocationId?: string;
}
