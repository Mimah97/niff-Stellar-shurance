import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../admin/audit.service';
import type { Response } from 'express';

@Injectable()
export class EvidenceProxyService {
  private readonly logger = new Logger(EvidenceProxyService.name);
  private readonly ipfsGateway: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    this.ipfsGateway = this.config.get<string>('IPFS_GATEWAY', 'https://ipfs.io');
  }

  async stream(
    claimId: number,
    index: number,
    walletAddress: string,
    res: Response,
  ): Promise<void> {
    // 1. Load claim
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      select: {
        id: true,
        creatorAddress: true,
        imageUrls: true,
        votes: {
          where: { deletedAt: null },
          select: { voterAddress: true },
        },
      },
    });

    if (!claim) {
      throw new NotFoundException(`Claim ${claimId} not found`);
    }

    // 2. Authorise: claimant, active voter, or admin
    const isClaimant = claim.creatorAddress.toLowerCase() === walletAddress.toLowerCase();
    const isVoter = claim.votes.some(
      (v) => v.voterAddress.toLowerCase() === walletAddress.toLowerCase(),
    );
    const adminToken = this.config.get<string>('ADMIN_TOKEN', '');
    const isAdmin = adminToken && walletAddress === adminToken;

    if (!isClaimant && !isVoter && !isAdmin) {
      await this.writeAudit(walletAddress, 'evidence_download_forbidden', { claimId, index });
      throw new ForbiddenException('Access denied: not the claimant, a voter, or an admin');
    }

    // 3. Resolve evidence URL
    if (index < 0 || index >= claim.imageUrls.length) {
      throw new NotFoundException(`Evidence index ${index} not found for claim ${claimId}`);
    }

    const rawUrl = claim.imageUrls[index];
    // Support both full gateway URLs and bare CIDs / ipfs:// URIs
    const gatewayUrl = this.resolveGatewayUrl(rawUrl);

    // 4. Stream from IPFS gateway
    this.logger.log(`Proxying evidence: claim=${claimId} index=${index} url=${gatewayUrl}`);

    let upstream: Response;
    try {
      const fetchResponse = await fetch(gatewayUrl);
      if (!fetchResponse.ok) {
        throw new Error(`Gateway returned ${fetchResponse.status}`);
      }

      const contentType = fetchResponse.headers.get('content-type') ?? 'application/octet-stream';
      const filename = `claim-${claimId}-evidence-${index}`;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');

      // Stream body to client
      const reader = fetchResponse.body?.getReader();
      if (!reader) throw new Error('No response body');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (err) {
      this.logger.error(`Evidence proxy failed: ${err}`);
      await this.writeAudit(walletAddress, 'evidence_download_failed', { claimId, index, error: String(err) });
      if (!res.headersSent) {
        res.status(502).json({ message: 'Failed to fetch evidence from IPFS' });
      }
      return;
    }

    // 5. Audit success
    await this.writeAudit(walletAddress, 'evidence_download', { claimId, index });
  }

  private resolveGatewayUrl(raw: string): string {
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    // ipfs://CID or bare CID
    const cid = raw.replace(/^ipfs:\/\//, '');
    return `${this.ipfsGateway}/ipfs/${cid}`;
  }

  private async writeAudit(actor: string, action: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.audit.write({ actor, action, payload: payload as Record<string, string | number | boolean | null> });
    } catch (err) {
      this.logger.warn(`Audit write failed for ${action}: ${err}`);
    }
  }
}
