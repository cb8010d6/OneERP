import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ResourceQueryDto {
  @ApiPropertyOptional({ description: 'Prisma where 过滤条件(JSON 字符串)' })
  @IsOptional()
  @IsString()
  filter?: string;

  @ApiPropertyOptional({ description: '字段选择(JSON 或逗号字符串)' })
  @IsOptional()
  @IsString()
  fields?: string;

  @ApiPropertyOptional({ description: '包含关联(JSON 字符串)' })
  @IsOptional()
  @IsString()
  include?: string;

  @ApiPropertyOptional({ description: '排序(JSON 字符串)' })
  @IsOptional()
  @IsString()
  orderBy?: string;

  @ApiPropertyOptional({ description: '关键词搜索（配合 searchFields）' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: '搜索字段(JSON 数组或逗号字符串)' })
  @IsOptional()
  @IsString()
  searchFields?: string;

  @ApiPropertyOptional({ description: '页码，从1开始', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页条数', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
