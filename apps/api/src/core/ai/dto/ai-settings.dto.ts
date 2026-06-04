import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class AISettingsDto {
  @ApiProperty({
    description: 'LLM provider 类型',
    required: false,
    enum: ['openai-compatible', 'anthropic-compatible'],
  })
  @IsOptional()
  @IsIn(['openai-compatible', 'anthropic-compatible'])
  provider?: 'openai-compatible' | 'anthropic-compatible';

  @ApiProperty({
    description: 'OpenAI-compatible base URL，例如 https://host/v1',
    required: false,
  })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(500)
  baseUrl?: string;

  @ApiProperty({
    description: '新 API key。仅写入时接收，读取接口不会返回明文。',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  apiKey?: string;

  @ApiProperty({
    description: '清除公司级 API key，之后回退到环境变量。',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean;

  @ApiProperty({ description: '默认模型', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  defaultModel?: string;

  @ApiProperty({ description: '高级模型', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  proModel?: string;

  @ApiProperty({
    description: 'Chat2SQL 是否默认使用高级模型',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  useProForSql?: boolean;

  @ApiProperty({ description: '单据草稿是否默认使用高级模型', required: false })
  @IsOptional()
  @IsBoolean()
  useProForDocuments?: boolean;
}
