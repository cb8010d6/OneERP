import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpsertAccountingPeriodDto {
  @ApiProperty({ description: '期间编号，例如 2026-06' })
  @IsString()
  @IsNotEmpty()
  periodKey!: string;

  @ApiProperty({ description: '期间开始日期 (ISO string)' })
  @IsString()
  @IsNotEmpty()
  startDate!: string;

  @ApiProperty({ description: '期间结束日期 (ISO string)' })
  @IsString()
  @IsNotEmpty()
  endDate!: string;
}

export class AccountingPeriodStatusQueryDto {
  @ApiProperty({
    description: '期间状态',
    enum: ['OPEN', 'CLOSED'],
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsIn(['OPEN', 'CLOSED'])
  status?: 'OPEN' | 'CLOSED';
}
