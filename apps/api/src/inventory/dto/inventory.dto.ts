import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsOptional,
  IsArray,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInboundDto {
  @ApiProperty({ description: '目标库位ID' })
  @IsString()
  @IsNotEmpty()
  destLocationId!: string;

  @ApiProperty({ description: '物料ID' })
  @IsString()
  @IsNotEmpty()
  materialId!: string;

  @ApiProperty({ description: '入库数量' })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ description: '批次号' })
  @IsOptional()
  @IsString()
  batchNo?: string;
}

export class CreateStockMoveDto {
  @ApiPropertyOptional({ description: '来源库位ID（入库时可为空）' })
  @IsOptional()
  @IsString()
  sourceLocationId?: string;

  @ApiPropertyOptional({ description: '目标库位ID（出库时可为空）' })
  @IsOptional()
  @IsString()
  destLocationId?: string;

  @ApiProperty({ description: '物料ID' })
  @IsString()
  @IsNotEmpty()
  materialId!: string;

  @ApiProperty({ description: '流转数量' })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ description: '本次入库/调整单位成本' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({ description: '批次号' })
  @IsOptional()
  @IsString()
  batchNo?: string;

  @ApiPropertyOptional({ description: '关联单号' })
  @IsOptional()
  @IsString()
  referenceNo?: string;

  @ApiPropertyOptional({
    description: '业务单据类型，如 SALE_ORDER / PURCHASE_ORDER',
  })
  @IsOptional()
  @IsString()
  documentType?: string;

  @ApiPropertyOptional({ description: '业务单据ID' })
  @IsOptional()
  @IsString()
  documentId?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class ScanOutboundDto {
  @ApiProperty({ description: '物料SKU码' })
  @IsString()
  @IsNotEmpty()
  materialSku!: string;

  @ApiProperty({ description: '出库数量' })
  @IsNumber()
  @Min(1)
  quantity!: number;
}

export class ApproveOutboundDto {
  @ApiProperty({ description: '确认的出库数量' })
  @IsNumber()
  @Min(1)
  quantity!: number;
}

export class SaleOrderShipmentDto {
  @ApiPropertyOptional({ description: '来源库位ID（建议填写）' })
  @IsOptional()
  @IsString()
  sourceLocationId?: string;

  @ApiProperty({
    description: '发货明细列表',
    type: () => [SaleOrderShipmentItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaleOrderShipmentItemDto)
  items!: SaleOrderShipmentItemDto[];

  @ApiPropertyOptional({
    description: '是否允许库存不足时部分发货；默认 false，整笔拒绝',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allowPartial?: boolean;

  @ApiPropertyOptional({ description: '批次号（可选）' })
  @IsOptional()
  @IsString()
  batchNo?: string;

  @ApiPropertyOptional({ description: '备注（可选）' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class SaleOrderShipmentItemDto {
  @ApiProperty({ description: '产品ID' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ description: '发货数量' })
  @IsNumber()
  @Min(1)
  shipQuantity!: number;
}

export class PurchaseInboundPostingDto {
  @ApiProperty({ description: '采购单号' })
  @IsString()
  @IsNotEmpty()
  purchaseNo!: string;

  @ApiProperty({ description: '物料ID' })
  @IsString()
  @IsNotEmpty()
  materialId!: string;

  @ApiProperty({ description: '入库数量' })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ description: '本次入库单位成本' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({ description: '目标库位ID' })
  @IsOptional()
  @IsString()
  destLocationId?: string;

  @ApiPropertyOptional({ description: '批次号' })
  @IsOptional()
  @IsString()
  batchNo?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class ReverseSaleOrderShipmentDto {
  @ApiPropertyOptional({ description: '冲销入库目标库位ID（可选）' })
  @IsOptional()
  @IsString()
  destLocationId?: string;

  @ApiPropertyOptional({ description: '冲销批次号（可选）' })
  @IsOptional()
  @IsString()
  batchNo?: string;

  @ApiPropertyOptional({ description: '冲销备注（可选）' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class ReversePurchaseInboundDto {
  @ApiPropertyOptional({
    description: '冲销出库来源库位ID（默认取原入库目标库位）',
  })
  @IsOptional()
  @IsString()
  sourceLocationId?: string;

  @ApiPropertyOptional({ description: '冲销批次号（可选）' })
  @IsOptional()
  @IsString()
  batchNo?: string;

  @ApiPropertyOptional({ description: '冲销备注（可选）' })
  @IsOptional()
  @IsString()
  note?: string;
}
