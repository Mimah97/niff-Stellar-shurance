import { Body, Controller, Get, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletAddress } from '../auth/decorators/wallet-address.decorator';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './profile.dto';

@ApiTags('profile')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /**
   * GET /profile
   * Returns the authenticated wallet's profile, creating a default record on first access.
   */
  @Get()
  @ApiOperation({ summary: 'Get own profile (auto-created on first access)' })
  async getProfile(@WalletAddress() walletAddress: string) {
    return this.profileService.getOrCreate(walletAddress);
  }

  /**
   * PATCH /profile
   * Partially updates the authenticated wallet's profile.
   */
  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update own profile' })
  async updateProfile(
    @WalletAddress() walletAddress: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profileService.update(walletAddress, dto);
  }
}
