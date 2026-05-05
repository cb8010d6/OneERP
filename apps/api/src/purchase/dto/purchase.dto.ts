import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsArray,
  ValidateNested,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PurchaseOrderItemDto {
  @ApiProperty({ description: '物料ID' })
  @IsString()
  @IsNotEmpty()
  materialId!: string;

  @ApiProperty({ description: '采购数量' })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: '单价' })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class CreatePurchaseOrderDto {
  @ApiProperty({ description: '供应商ID' })
  @IsString()
  @IsNotEmpty()
  supplierId!: string;

  @ApiProperty({ description: '采购单明细', type: [PurchaseOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items!: PurchaseOrderItemDto[];

  @ApiPropertyOptional({ description: '预计到货日期' })
  @IsOptional()
  @IsString()
  expectedDate?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePurchaseOrderStatusDto {
  @ApiProperty({
    description: '新状态',
    enum: ['CONFIRMED', 'CANCELLED'],
  })
  @IsEnum(['CONFIRMED', 'CANCELLED'])
  status!: string;
}

export class ReceivePurchaseItemDto {
  @ApiProperty({ description: '采购单ID' })
  @IsString()
  @IsNotEmpty()
  purchaseOrderId!: string;

  @ApiProperty({ description: '采购单明细ID' })
  @IsString()
  @IsNotEmpty()
  itemId!: string;

  @ApiProperty({ description: '本次收货数量' })
  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @ApiProperty({ description: '目标库位ID' })
  @IsString()
  @IsNotEmpty()
  destLocationId!: string;

  @ApiPropertyOptional({ description: '批次号（支持扫描或手动输入）' })
  @IsOptional()
  @IsString()
  batchNo?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class ScanReceiveDto {
  @ApiProperty({ description: '物料SKU码' })
  @IsString()
  @IsNotEmpty()
  materialSku!: string;

  @ApiProperty({ description: '收货数量' })
  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @ApiProperty({ description: '目标库位ID' })
  @IsString()
  @IsNotEmpty()
  destLocationId!: string;

  @ApiPropertyOptional({ description: '批次号' })
  @IsOptional()
  @IsString()
  batchNo?: string;
}
