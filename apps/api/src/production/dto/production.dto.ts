import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class CreateWorkOrderDto {
  @ApiProperty({ description: '关联的销售订单ID' })
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @ApiProperty({ description: '大纲/产品ID' })
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({ description: '计划生产数量' })
  @IsNumber()
  @Min(1)
  plannedQty: number;
}

export class CreateWorkReportDto {
  @ApiProperty({ description: '良品数量' })
  @IsNumber()
  @Min(0)
  goodQty: number;

  @ApiProperty({ description: '不良品数量' })
  @IsNumber()
  @Min(0)
  defectQty: number;
}
