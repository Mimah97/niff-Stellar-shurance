import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateFaqItemDto {
  @ApiProperty({ example: 'How does coverage work?' })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  question!: string;

  @ApiProperty({ example: 'You submit a quote and pay a premium…' })
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  answer!: string;

  @ApiPropertyOptional({ example: 'Coverage' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  displayOrder?: number;
}

export class UpdateFaqItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  question?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  answer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  displayOrder?: number;
}

class FaqOrderEntry {
  @IsString()
  id!: string;

  @IsInt()
  displayOrder!: number;
}

export class ReorderFaqItemsDto {
  @ApiProperty({ type: [FaqOrderEntry] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FaqOrderEntry)
  items!: FaqOrderEntry[];
}
