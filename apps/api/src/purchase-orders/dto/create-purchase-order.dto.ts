import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsArray,
  ValidateNested,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

// ---- 行项 DTO ----

export class AddPurchaseOrderLineDto {
  @ApiPropertyOptional({
    description: '物料ID（materialId 与 productId 二选一）',
  })
  @IsOptional()
  @IsString()
  materialId?: string;

  @ApiPropertyOptional({
    description: '产品ID（materialId 与 productId 二选一）',
  })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ description: '行描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '数量' })
  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @ApiProperty({ description: '单价' })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ description: '税率 (0~1)，默认 0.13' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;
}

// ---- 创建采购单 DTO ----

export class CreatePurchaseOrderDto {
  @ApiProperty({ description: '供应商ID (partnerId)' })
  @IsString()
  @IsNotEmpty()
  partnerId!: string;

  @ApiPropertyOptional({ description: '预计到货日期' })
  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: '初始行项列表（可选，也可后续通过添加行项接口补充）',
    type: [AddPurchaseOrderLineDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddPurchaseOrderLineDto)
  lines?: AddPurchaseOrderLineDto[];
}
