import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreateTimelineCommentDto {
  @ApiProperty({
    description: '评论内容',
    example: '库存不足，请采购部门跟进。',
  })
  @IsString()
  @MinLength(1)
  content!: string;
}
