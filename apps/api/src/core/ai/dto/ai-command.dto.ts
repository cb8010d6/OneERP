import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

class AIToolOverrideDto {
  @ApiProperty({ description: '工具名称', example: 'create_resource' })
  @IsString()
  toolName: string;

  @ApiProperty({ description: '工具参数' })
  @IsObject()
  args: Record<string, unknown>;
}

export class AICommandDto {
  @ApiProperty({
    description: '用户自然语言指令',
    example: '创建一个客户，名称是微软中国',
  })
  @IsString()
  @MinLength(2)
  input: string;

  @ApiProperty({
    description: '是否仅返回草稿而不执行写操作',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiProperty({
    description: '确认执行时传入后端已解析工具调用',
    required: false,
    type: AIToolOverrideDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AIToolOverrideDto)
  overrideTool?: AIToolOverrideDto;
}

export class AIChat2DashDto {
  @ApiProperty({ description: '分析型问题', example: '过去一周订单状态分布' })
  @IsString()
  @MinLength(2)
  input: string;
}

export class AIChat2SqlDto {
  @ApiProperty({
    description: '自然语言查询',
    example: '显示本月利润率低于15%的产品',
  })
  @IsString()
  @MinLength(2)
  input: string;
}
