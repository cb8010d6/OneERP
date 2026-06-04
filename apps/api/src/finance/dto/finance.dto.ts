import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
  IsIn,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInvoiceDto {
  @ApiProperty({ description: '关联订单ID' })
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @ApiProperty({ description: '发票金额' })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiProperty({
    description: '税码ID (建议填写，未填将使用默认税码)',
    required: false,
  })
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

  @ApiProperty({
    description: '支付方式: BANK_TRANSFER, CASH, ALIPAY, WECHAT',
    enum: ['BANK_TRANSFER', 'CASH', 'ALIPAY', 'WECHAT'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['BANK_TRANSFER', 'CASH', 'ALIPAY', 'WECHAT'])
  method!: string;
}

export class ReceivablePaymentAllocationDto {
  @ApiProperty({ description: '待核销的应收发票 ID' })
  @IsString()
  @IsNotEmpty()
  invoiceId!: string;

  @ApiProperty({ description: '本次分配到该发票的金额' })
  @IsNumber()
  @Min(0.01)
  amount!: number;
}

export class CreateReceivablePaymentDto {
  @ApiProperty({ description: '客户/往来单位 ID' })
  @IsString()
  @IsNotEmpty()
  partnerId!: string;

  @ApiProperty({ description: '收款总金额' })
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({
    description: '支付方式: BANK_TRANSFER, CASH, ALIPAY, WECHAT',
    enum: ['BANK_TRANSFER', 'CASH', 'ALIPAY', 'WECHAT'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['BANK_TRANSFER', 'CASH', 'ALIPAY', 'WECHAT'])
  method!: string;

  @ApiProperty({ type: [ReceivablePaymentAllocationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivablePaymentAllocationDto)
  allocations?: ReceivablePaymentAllocationDto[];
}

export class ApplyReceivablePaymentDto {
  @ApiProperty({ type: [ReceivablePaymentAllocationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivablePaymentAllocationDto)
  allocations!: ReceivablePaymentAllocationDto[];
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

export class CreateCreditNoteDto {
  @ApiProperty({ description: '要冲减的原应收发票 ID' })
  @IsString()
  @IsNotEmpty()
  invoiceId!: string;

  @ApiProperty({ description: '贷项/红字金额，含税' })
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({
    description: '税码ID (未填则沿用原发票税码或公司默认税码)',
    required: false,
  })
  @IsOptional()
  @IsString()
  taxCodeId?: string;

  @ApiProperty({
    description: '关联的销售退货单 ID，用于把库存退货与财务红字闭环',
    required: false,
  })
  @IsOptional()
  @IsString()
  inventoryReturnDocumentId?: string;

  @ApiProperty({
    description: '冲减原因，例如客户退货、价格折让、开票错误',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ description: '贷项日期 (ISO string)', required: false })
  @IsOptional()
  @IsString()
  creditDate?: string;
}

export class CreateCustomerRefundDto {
  @ApiProperty({ description: '关联的已过账贷项凭证 ID' })
  @IsString()
  @IsNotEmpty()
  creditNoteId!: string;

  @ApiProperty({ description: '退款金额' })
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({
    description: '退款方式: BANK_TRANSFER, CASH, ALIPAY, WECHAT',
    enum: ['BANK_TRANSFER', 'CASH', 'ALIPAY', 'WECHAT'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['BANK_TRANSFER', 'CASH', 'ALIPAY', 'WECHAT'])
  method!: string;

  @ApiProperty({ description: '退款日期 (ISO string)', required: false })
  @IsOptional()
  @IsString()
  refundDate?: string;

  @ApiProperty({ description: '退款备注', required: false })
  @IsOptional()
  @IsString()
  note?: string;
}
