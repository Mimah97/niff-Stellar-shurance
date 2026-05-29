import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './profile.dto';
import type { HolderProfile } from '@prisma/client';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the profile for the wallet, creating a default one on first access. */
  async getOrCreate(walletAddress: string): Promise<HolderProfile> {
    return this.prisma.holderProfile.upsert({
      where: { walletAddress },
      create: { walletAddress },
      update: {},
    });
  }

  /** Updates only the supplied fields for the wallet's own profile. */
  async update(walletAddress: string, dto: UpdateProfileDto): Promise<HolderProfile> {
    const notifPrefs = dto.notificationPreferences as Prisma.InputJsonValue | undefined;
    return this.prisma.holderProfile.upsert({
      where: { walletAddress },
      create: {
        walletAddress,
        displayName: dto.displayName,
        email: dto.email,
        locale: dto.locale,
        notificationPreferences: notifPrefs ?? Prisma.JsonNull,
      },
      update: {
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.locale !== undefined && { locale: dto.locale }),
        ...(notifPrefs !== undefined && { notificationPreferences: notifPrefs }),
      },
    });
  }
}
