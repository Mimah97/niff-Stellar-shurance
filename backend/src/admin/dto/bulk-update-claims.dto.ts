import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, ArrayMaxSize, ArrayMinSize } from 'class-validator';
import { ClaimStatus } from '@prisma/client';

export const BULK_UPDATE_MAX_BATCH = 100;

export class BulkUpdateClaimsDto {
  @ApiProperty({ description: 'Claim IDs to update', type: [Number], example: [1, 2, 3] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_UPDATE_MAX_BATCH)
  @IsInt({ each: true })
  claimIds!: number[];

  @ApiProperty({ enum: ClaimStatus, description: 'Target status' })
  @IsEnum(ClaimStatus)
  newStatus!: ClaimStatus;

  @ApiProperty({ description: 'Mandatory reason for audit trail' })
  @IsString()
  reason!: string;

  @ApiPropertyOptional({ description: 'If true, returns affected claims without modifying data', default: false })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
