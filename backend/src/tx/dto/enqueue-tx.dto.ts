import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, Matches } from 'class-validator';

export class EnqueueTxDto {
  @ApiProperty({ description: 'Base64-encoded signed XDR envelope', example: 'AAAAAgAAAAA...' })
  @IsString()
  @Matches(/^[A-Za-z0-9+/]+=*$/, { message: 'signed_xdr must be a valid base64 string' })
  signed_xdr!: string;

  @ApiPropertyOptional({ description: 'Idempotency key (UUID v4)', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsOptional()
  @IsUUID(4)
  idempotency_key?: string;
}
