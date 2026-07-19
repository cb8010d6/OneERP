import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class EngineeringChangeImpactDto {
  @ApiProperty()
  @IsUUID()
  workOrderId!: string;

  @ApiProperty({ enum: ['CONTINUE_OLD', 'SWITCH_NEW', 'SCRAP_REWORK'] })
  @IsIn(['CONTINUE_OLD', 'SWITCH_NEW', 'SCRAP_REWORK'])
  decision!: 'CONTINUE_OLD' | 'SWITCH_NEW' | 'SCRAP_REWORK';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CreateEngineeringChangeOrderDto {
  @ApiProperty()
  @IsUUID()
  targetRevisionId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  impactAssessment!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  materialDisposition!: string;

  @ApiProperty({ type: [EngineeringChangeImpactDto] })
  @IsArray()
  @ArrayUnique((impact: EngineeringChangeImpactDto) => impact.workOrderId)
  @ValidateNested({ each: true })
  @Type(() => EngineeringChangeImpactDto)
  impacts!: EngineeringChangeImpactDto[];
}

export class DecideEngineeringChangeOrderDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
