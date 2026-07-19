import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateEngineeringDocumentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ enum: ['DRAWING', 'SPECIFICATION', 'PROCESS'] })
  @IsIn(['DRAWING', 'SPECIFICATION', 'PROCESS'])
  documentType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  externalNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiProperty()
  @IsUUID()
  fileRecordId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class AddEngineeringRevisionDto {
  @ApiProperty()
  @IsUUID()
  fileRecordId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ReviewEngineeringRevisionDto {
  @ApiProperty({ enum: ['APPROVE', 'REQUEST_CHANGES'] })
  @IsIn(['APPROVE', 'REQUEST_CHANGES'])
  decision!: 'APPROVE' | 'REQUEST_CHANGES';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
