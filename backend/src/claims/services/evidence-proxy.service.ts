import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../admin/audit.service';
import type { Response } from 'express';
import { createHash } from 'crypto';

export interface EvidenceFetchResponseDto {
  content: Buffer;
  contentType: string;
  filename: string;
  evidenceUrl: string;
  verified: boolean;
  hashMismatch: boolean;
  fetchedSha256Hex: string;
}

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

  async fetch(
    claimId: number,
    index: number,
    walletAddress: string,
  ): Promise<EvidenceFetchResponseDto> {
    const claim = await this.loadClaim(claimId);

    // 2. Authorise: claimant, active voter, or admin
    this.assertAuthorized(claim, walletAddress);

    // 3. Resolve evidence URL
    if (index < 0 || index >= claim.imageUrls.length) {
      throw new NotFoundException(`Evidence index ${index} not found for claim ${claimId}`);
    }

    const rawUrl = claim.imageUrls[index];
    const gatewayUrl = this.resolveGatewayUrl(rawUrl);
    this.logger.log(`Fetching evidence: claim=${claimId} index=${index} url=${gatewayUrl}`);

    const fetchResponse = await fetch(gatewayUrl);
    if (!fetchResponse.ok) {
      throw new Error(`Gateway returned ${fetchResponse.status}`);
    }

    const contentType = fetchResponse.headers.get('content-type') ?? 'application/octet-stream';
    const content = Buffer.from(await fetchResponse.arrayBuffer());
    const fetchedSha256Hex = createHash('sha256').update(content).digest('hex');

    const storedHash = await this.getStoredEvidenceHash(claim, index);
    const hashMismatch = storedHash ? storedHash !== fetchedSha256Hex : false;
    const verified = storedHash ? !hashMismatch : false;

    if (hashMismatch) {
      await this.writeAudit(walletAddress, 'evidence_hash_mismatch', {
        claimId,
        index,
        evidenceUrl: rawUrl,
        storedHash,
        fetchedHash: fetchedSha256Hex,
      });
    }

    const filename = `claim-${claimId}-evidence-${index}`;
    return {
      content,
      contentType,
      filename,
      evidenceUrl: gatewayUrl,
      verified,
      hashMismatch,
      fetchedSha256Hex,
    };
  }

  async stream(
    claimId: number,
    index: number,
    walletAddress: string,
    res: Response,
  ): Promise<void> {
    try {
      const result = await this.fetch(claimId, index, walletAddress);
      this.logger.log(
        `Proxying evidence: claim=${claimId} index=${index} url=${result.evidenceUrl} verified=${result.verified}`,
      );

      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.write(result.content);
      res.end();
    } catch (err) {
      this.logger.error(`Evidence proxy failed: ${err}`);
      await this.writeAudit(walletAddress, 'evidence_download_failed', {
        claimId,
        index,
        error: String(err),
      });
      if (!res.headersSent) {
        res.status(502).json({ message: 'Failed to fetch evidence from IPFS' });
      }
      return;
    }

    // 5. Audit success
    await this.writeAudit(walletAddress, 'evidence_download', { claimId, index });
  }

  private async loadClaim(claimId: number) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      select: {
        id: true,
        creatorAddress: true,
        imageUrls: true,
        txHash: true,
        eventIndex: true,
        votes: {
          where: { deletedAt: null },
          select: { voterAddress: true },
        },
      },
    });

    if (!claim) {
      throw new NotFoundException(`Claim ${claimId} not found`);
    }

    return claim;
  }

  private assertAuthorized(
    claim: { creatorAddress: string; votes: { voterAddress: string }[] },
    walletAddress: string,
  ): void {
    const isClaimant = claim.creatorAddress.toLowerCase() === walletAddress.toLowerCase();
    const isVoter = claim.votes.some(
      (v) => v.voterAddress.toLowerCase() === walletAddress.toLowerCase(),
    );
    const adminToken = this.config.get<string>('ADMIN_TOKEN', '');
    const isAdmin = adminToken && walletAddress === adminToken;

    if (!isClaimant && !isVoter && !isAdmin) {
      throw new ForbiddenException('Access denied: not the claimant, a voter, or an admin');
    }
  }

  private async getStoredEvidenceHash(
    claim: { txHash: string | null; eventIndex: number | null },
    index: number,
  ): Promise<string | null> {
    if (!claim.txHash || claim.eventIndex == null) {
      return null;
    }

    const rawEvent = await this.prisma.rawEvent.findUnique({
      where: {
        txHash_eventIndex: {
          txHash: claim.txHash,
          eventIndex: claim.eventIndex,
        },
      },
      select: { data: true },
    });

    const evidenceHashes = (rawEvent?.data as { evidence_hashes?: unknown } | null)?.evidence_hashes;
    if (!Array.isArray(evidenceHashes)) {
      return null;
    }

    const stored = evidenceHashes[index];
    if (typeof stored !== 'string' || stored.length === 0) {
      return null;
    }

    return stored.toLowerCase();
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
