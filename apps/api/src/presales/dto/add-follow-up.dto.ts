import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AddFollowUpDto {
  @ApiProperty({ description: '跟进内容' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;

  @ApiPropertyOptional({ description: '下一次跟进时间' })
  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string;
}
