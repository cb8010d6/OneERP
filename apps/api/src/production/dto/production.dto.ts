import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsNotEmpty,
  IsNumber,
  IsBoolean,
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
}

export class CreateWorkReportDto {
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

export class GenerateWorkOrdersFromOrderDto {
  @ApiPropertyOptional({
    description: '已存在同销售订单/产品工单时是否跳过，默认 true',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  skipExisting?: boolean;
}
