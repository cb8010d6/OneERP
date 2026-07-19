import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePurchaseOrderLineDto {
  @IsString()
  @IsNotEmpty()
  materialId!: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreatePurchaseOrderDto {
  @IsString()
  @IsNotEmpty()
  supplierId!: string;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  items!: CreatePurchaseOrderLineDto[];
}

export class ReceivePurchaseLineDto {
  @IsString()
  @IsNotEmpty()
  purchaseOrderLineId!: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsOptional()
  @IsString()
  destLocationId?: string;

  @IsOptional()
  @IsString()
  batchNo?: string;
}

export class ReceivePurchaseOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseLineDto)
  lines!: ReceivePurchaseLineDto[];

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreatePurchaseInvoiceDto {
  @IsOptional()
  @IsString()
  invoiceNo?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class CreateSupplierCreditNoteDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  inventoryReturnDocumentId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsDateString()
  creditDate?: string;
}

export class SupplierPaymentAllocationDto {
  @IsString()
  @IsNotEmpty()
  purchaseInvoiceId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;
}

export class CreateSupplierPaymentDto {
  @IsString()
  @IsNotEmpty()
  supplierId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  @IsIn(['BANK_TRANSFER', 'CASH', 'ALIPAY', 'WECHAT'])
  method!: string;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SupplierPaymentAllocationDto)
  allocations!: SupplierPaymentAllocationDto[];
}
