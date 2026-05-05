import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsOptional,
} from 'class-validator';

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

  @ApiPropertyOptional({ description: '批次号（可选）' })
  @IsOptional()
  @IsString()
  batchNo?: string;

  @ApiPropertyOptional({ description: '备注（可选）' })
  @IsOptional()
  @IsString()
  note?: string;
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

export class CreatePickingDto {
  @ApiPropertyOptional({ description: '来源库位ID（整单出库时统一指定）' })
  @IsOptional()
  @IsString()
  sourceLocationId?: string;

  @ApiPropertyOptional({ description: '目标库位ID（整单入库时统一指定）' })
  @IsOptional()
  @IsString()
  destLocationId?: string;

  @ApiPropertyOptional({ description: '计划执行日期' })
  @IsOptional()
  scheduledDate?: string;
}

export class ConfirmPickingDto {
  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  note?: string;
}
