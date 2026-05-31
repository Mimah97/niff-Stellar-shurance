import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class CreateSupportTicketDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(5)
  @MaxLength(200)
  subject: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message: string;

  @IsString()
  captchaToken: string;
}

export class UpdateSupportTicketDto {
  @IsString()
  status: 'open' | 'in_progress' | 'resolved' | 'closed';

  @IsString()
  @MaxLength(500)
  internalNotes?: string;
}

export class SupportTicketResponseDto {
  id: number;
  email: string;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  ipHash: string;
  createdAt: Date;
  updatedAt: Date;
}
