import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class CreateInvoiceDto {
  @ApiProperty({ description: '关联订单ID' })
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @ApiProperty({ description: '发票金额' })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiProperty({ description: '税码ID (建议填写，未填将使用默认税码)', required: false })
  @IsOptional()
  @IsString()
  taxCodeId?: string;

  @ApiProperty({ description: '计划收款日期 (ISO string)' })
  @IsString()
  dueDate!: string;
}

export class CreatePaymentDto {
  @ApiProperty({ description: '支付金额' })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty({ description: '支付方式: BANK_TRANSFER, ALIPAY, WECHAT' })
  @IsString()
  @IsNotEmpty()
  method!: string;
}

export class PostInvoiceDto {
  @ApiProperty({
    description: '税码ID (建议填写，未填将使用默认税码)',
    required: false,
  })
  @IsOptional()
  @IsString()
  taxCodeId?: string;

  @ApiProperty({
    description: '税率，默认0.13 (兼容旧调用)',
    required: false,
    example: 0.13,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  taxRate?: number;
}
