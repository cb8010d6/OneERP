import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class QuoteDecisionDto {
  @ApiProperty({ enum: ['ACCEPTED', 'REJECTED'] })
  @IsIn(['ACCEPTED', 'REJECTED'])
  status!: 'ACCEPTED' | 'REJECTED';
}
