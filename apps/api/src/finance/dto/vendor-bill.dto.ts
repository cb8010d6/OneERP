import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class VendorBillLineDto {
  @ApiProperty({ description: '物料ID' })
  @IsString()
  @IsNotEmpty()
  materialId!: string;

  @ApiProperty({ description: '数量' })
  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @ApiProperty({ description: '单价' })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ description: '税码ID（可选，未填使用发票级或默认税码�? })
  @IsOptional()
  @IsString()
  taxCodeId?: string;

  @ApiPropertyOptional({ description: 'accountId for debit posting' })
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional({ description: '行描�? })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateVendorBillDto {
  @ApiProperty({ description: '供应商ID' })
  @IsString()
  @IsNotEmpty()
  partnerId!: string;

  @ApiPropertyOptional({ description: '关联入库单ID（从入库单生成时填写�? })
  @IsOptional()
  @IsString()
  receiptId?: string;

  @ApiPropertyOptional({ description: '发票号码（外部供应商发票号）' })
  @IsOptional()
  @IsString()
  invoiceNo?: string;

  @ApiProperty({ description: '税码ID（发票级默认税码�?, required: false })
  @IsOptional()
  @IsString()
  taxCodeId?: string;

  @ApiProperty({ description: '应付到期日期 (ISO string)' })
  @IsDateString()
  dueDate!: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ description: '行项目列�?, type: [VendorBillLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VendorBillLineDto)
  lines!: VendorBillLineDto[];
}

export class RecordVendorBillPaymentDto {
  @ApiProperty({ description: '付款金额' })
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({ description: '付款方式: BANK_TRANSFER, CASH, CHECK' })
  @IsString()
  @IsNotEmpty()
  method!: string;

  @ApiPropertyOptional({ description: '付款备注' })
  @IsOptional()
  @IsString()
  notes?: string;
}
