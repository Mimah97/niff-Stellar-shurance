import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Tenant } from '@prisma/client';

export interface CreateTenantDto {
  name: string;
  contractIds: string[];
}

export interface UpdateTenantDto {
  name?: string;
  contractIds?: string[];
  active?: boolean;
}

@Injectable()
export class AdminTenantsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateTenantDto): Promise<Tenant> {
    // Check for contract ID conflicts
    const existingTenants = await this.prisma.tenant.findMany({
      where: { active: true },
    });

    for (const contractId of dto.contractIds) {
      for (const tenant of existingTenants) {
        if (tenant.contractIds.includes(contractId)) {
          throw new BadRequestException({
            code: 'CONTRACT_ID_CONFLICT',
            message: `Contract ID ${contractId} is already assigned to tenant ${tenant.id}`,
            conflictingTenantId: tenant.id,
          });
        }
      }
    }

    return this.prisma.tenant.create({
      data: {
        name: dto.name,
        contractIds: dto.contractIds,
        active: true,
      },
    });
  }

  async findAll(): Promise<Tenant[]> {
    return this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} not found`);
    }
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    await this.findOne(id); // Verify exists

    // Check for contract ID conflicts when updating
    if (dto.contractIds) {
      const existingTenants = await this.prisma.tenant.findMany({
        where: { active: true, NOT: { id } },
      });

      for (const contractId of dto.contractIds) {
        for (const tenant of existingTenants) {
          if (tenant.contractIds.includes(contractId)) {
            throw new BadRequestException({
              code: 'CONTRACT_ID_CONFLICT',
              message: `Contract ID ${contractId} is already assigned to another tenant`,
              conflictingTenantId: tenant.id,
            });
          }
        }
      }
    }

    return this.prisma.tenant.update({
      where: { id },
      data: dto,
    });
  }

  async delete(id: string): Promise<Tenant> {
    await this.findOne(id);
    return this.prisma.tenant.update({
      where: { id },
      data: { active: false },
    });
  }
}
