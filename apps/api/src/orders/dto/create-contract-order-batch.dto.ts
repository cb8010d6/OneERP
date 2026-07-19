import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ContractOrderBatchItemDto {
  @ApiProperty()
  @IsUUID()
  quoteVersionItemId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateContractOrderBatchDto {
  @ApiProperty({ description: '调用方稳定批次键，重复提交返回同一订单' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  sourceBatchKey!: string;

  @ApiProperty({ type: [ContractOrderBatchItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ContractOrderBatchItemDto)
  items!: ContractOrderBatchItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
