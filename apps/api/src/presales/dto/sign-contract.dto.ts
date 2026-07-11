import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class SignContractDto {
  @ApiProperty({ description: '已上传至公司文件库的签署件 ID' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  fileRecordId!: string;
}
