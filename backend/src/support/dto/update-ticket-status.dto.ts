import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTicketStatusDto {
  @ApiProperty({ enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] })
  @IsEnum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
  status!: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

  @ApiProperty({ required: false, description: 'Internal notes visible only to staff' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  internalNotes?: string;
}
