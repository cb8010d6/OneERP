import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsNumber,
  IsBoolean,
  IsDateString,
  IsUUID,
  ArrayMinSize,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateWorkOrderDto {
  @ApiProperty({ description: '关联的销售订单ID' })
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @ApiProperty({ description: '大纲/产品ID' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ description: '计划生产数量' })
  @IsNumber()
  @Min(1)
  plannedQty!: number;

  @ApiProperty({ description: '工单固定使用的当前已发布工程版本 ID' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  engineeringRevisionIds!: string[];
}

export class CreateWorkReportDto {
  @ApiProperty({
    description: '客户端生成的报工幂等键，同一次提交重试时保持不变',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey!: string;

  @ApiProperty({ description: '良品数量' })
  @IsNumber()
  @Min(0)
  goodQty!: number;

  @ApiProperty({ description: '不良品数量' })
  @IsNumber()
  @Min(0)
  defectQty!: number;

  @ApiPropertyOptional({ description: '原料领用库位ID' })
  @IsOptional()
  @IsString()
  sourceLocationId?: string;

  @ApiPropertyOptional({ description: '成品入库库位ID' })
  @IsOptional()
  @IsString()
  destLocationId?: string;

  @ApiPropertyOptional({ description: '成品批次号' })
  @IsOptional()
  @IsString()
  batchNo?: string;
}

export class ReverseWorkReportDto {
  @ApiProperty({ description: '客户端生成的冲销幂等键，同一次重试保持不变' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey!: string;

  @ApiProperty({ description: '冲销原因' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class GenerateWorkOrdersFromOrderDto {
  @ApiPropertyOptional({
    description: '已存在同销售订单/产品工单时是否跳过，默认 true',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  skipExisting?: boolean;

  @ApiProperty({ description: '本批工单固定使用的当前已发布工程版本 ID' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  engineeringRevisionIds!: string[];
}

export class CreatePurchaseOrderFromShortagesDto {
  @ApiProperty({ description: '供应商ID' })
  @IsString()
  @IsNotEmpty()
  supplierId!: string;

  @ApiPropertyOptional({
    description: '只采购指定物料ID；为空时采购全部短缺物料',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  materialIds?: string[];

  @ApiPropertyOptional({ description: '预计到货日期' })
  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @ApiPropertyOptional({ description: '采购备注' })
  @IsOptional()
  @IsString()
  notes?: string;
}
