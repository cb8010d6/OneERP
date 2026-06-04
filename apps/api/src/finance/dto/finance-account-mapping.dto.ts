import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FinanceAccountMappingItemDto {
  @ApiProperty({ description: '映射键，例如 RECEIVABLE / SALES_REVENUE' })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({ description: '会计科目 ID' })
  @IsString()
  @IsNotEmpty()
  accountId!: string;
}

export class UpdateFinanceAccountMappingsDto {
  @ApiProperty({ type: [FinanceAccountMappingItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FinanceAccountMappingItemDto)
  mappings!: FinanceAccountMappingItemDto[];
}
