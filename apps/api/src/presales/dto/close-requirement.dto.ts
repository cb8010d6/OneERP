import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CloseRequirementDto {
  @ApiProperty({ enum: ['LOST', 'CANCELLED'] })
  @IsIn(['LOST', 'CANCELLED'])
  status!: 'LOST' | 'CANCELLED';

  @ApiPropertyOptional({ description: '关闭原因；丢单时必填' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
