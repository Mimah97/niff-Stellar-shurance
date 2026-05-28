import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString } from 'class-validator';
import { WalletAuthService } from './wallet-auth.service';
import { ChallengeDto, VerifyDto } from './dto/challenge.dto';

class RefreshDto {
  @IsString()
  refreshToken!: string;
}

class LogoutDto {
  @IsString()
  refreshToken!: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly walletAuthService: WalletAuthService) {}

  /**
   * POST /api/auth/challenge
   * Issue a domain-bound challenge nonce.
   */
  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 300_000 } })
  @ApiOperation({ summary: 'Request a wallet challenge nonce' })
  @ApiResponse({
    status: 200,
    description: 'Challenge issued. Sign the message and POST to /auth/verify.',
  })
  async challenge(@Body() dto: ChallengeDto) {
    return this.walletAuthService.generateChallenge(dto.publicKey);
  }

  /**
   * POST /api/auth/verify
   * Verify Ed25519 signature and issue a scoped JWT.
   * JWT: sub=publicKey, scope=user — no admin capabilities.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 300_000 } })
  @ApiOperation({ summary: 'Verify Ed25519 signature and obtain a JWT' })
  @ApiResponse({
    status: 200,
    description: 'JWT issued. sub=publicKey, scope=user.',
  })
  async verify(@Body() dto: VerifyDto) {
    return this.walletAuthService.verifyChallenge(
      dto.publicKey,
      dto.nonce,
      dto.signature,
    );
  }

  /**
   * POST /api/auth/refresh
   * Exchange a valid refresh token for a new access + refresh token pair.
   * The submitted refresh token is immediately invalidated (rotation).
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate refresh token and obtain a new access token' })
  @ApiResponse({ status: 200, description: 'New access + refresh token pair.' })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or reused refresh token.' })
  async refresh(@Body() dto: RefreshDto) {
    return this.walletAuthService.refresh(dto.refreshToken);
  }

  /**
   * POST /api/auth/logout
   * Immediately revoke the active refresh token.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Revoke refresh token (logout)' })
  @ApiResponse({ status: 204, description: 'Logged out.' })
  async logout(@Body() dto: LogoutDto) {
    await this.walletAuthService.logout(dto.refreshToken);
  }
}
