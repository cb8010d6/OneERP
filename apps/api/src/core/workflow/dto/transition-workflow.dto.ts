import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject } from 'class-validator';
import { IsOptional, IsString } from 'class-validator';

export class TransitionWorkflowDto {
  @ApiProperty({ description: '动作编码，如 ship/cancel/start' })
  @IsString()
  action: string;

  @ApiPropertyOptional({ description: '流转备注' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description: '动作附加数据，如发货时 sourceLocationId/batchNo 等',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  data?: Record<string, unknown>;
}
