import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { claimTenantWhere } from '../../tenant/tenant-filter.helper';

export interface ClaimHistoryEntry {
  status: string;
  ledger: number;
  timestamp: string;
  actor?: string;
  reason?: string;
}

export interface ClaimHistoryPage {
  data: ClaimHistoryEntry[];
  nextCursor: string | null;
}

// Status-change event topic patterns sourced from the event dictionary
const STATUS_CHANGE_TOPICS = ['claim_pd', 'claim_filed', 'claim_approved', 'claim_rejected'];

@Injectable()
export class ClaimHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantCtx: TenantContextService,
  ) {}

  async getHistory(
    claimId: number,
    cursor?: string,
    limit = 20,
  ): Promise<ClaimHistoryPage> {
    const tenantId = this.tenantCtx.tenantId;

    // Verify claim exists and belongs to tenant
    const claim = await this.prisma.claim.findFirst({
      where: claimTenantWhere(tenantId, { id: claimId }),
      select: { id: true, txHash: true, createdAtLedger: true, createdAt: true, status: true },
    });
    if (!claim) throw new NotFoundException(`Claim ${claimId} not found`);

    const take = Math.min(Math.max(1, limit), 100);

    // Decode cursor: base64url-encoded ledger number
    let afterLedger: number | undefined;
    let afterId: number | undefined;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
          ledger: number;
          id: number;
        };
        afterLedger = decoded.ledger;
        afterId = decoded.id;
      } catch {
        // ignore invalid cursor — start from beginning
      }
    }

    // Query raw_events for this claim's txHash and status-change topics
    const events = await this.prisma.rawEvent.findMany({
      where: {
        txHash: claim.txHash ?? undefined,
        ...(afterLedger !== undefined && afterId !== undefined
          ? {
              OR: [
                { ledger: { gt: afterLedger } },
                { ledger: afterLedger, id: { gt: afterId } },
              ],
            }
          : {}),
        OR: STATUS_CHANGE_TOPICS.map((t) => ({ topic1: t })),
      },
      orderBy: [{ ledger: 'asc' }, { id: 'asc' }],
      take: take + 1,
    });

    // Also include the initial filed event by claim's own txHash
    const hasMore = events.length > take;
    const page = hasMore ? events.slice(0, take) : events;

    const data: ClaimHistoryEntry[] = page.map((e) => {
      const raw = e.data as Record<string, unknown>;
      return {
        status: mapTopicToStatus(e.topic1 ?? ''),
        ledger: e.ledger,
        timestamp: e.ledgerClosedAt.toISOString(),
        actor: typeof raw['actor'] === 'string' ? raw['actor'] : undefined,
        reason: typeof raw['reason'] === 'string' ? raw['reason'] : undefined,
      };
    });

    // If no raw_events found, synthesize from the claim row itself
    if (data.length === 0 && !cursor) {
      data.push({
        status: 'pending',
        ledger: claim.createdAtLedger,
        timestamp: claim.createdAt.toISOString(),
      });
      if (claim.status !== 'PENDING') {
        data.push({
          status: claim.status.toLowerCase(),
          ledger: claim.createdAtLedger,
          timestamp: claim.createdAt.toISOString(),
        });
      }
    }

    let nextCursor: string | null = null;
    if (hasMore && page.length > 0) {
      const last = page[page.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ ledger: last.ledger, id: last.id }),
      ).toString('base64url');
    }

    return { data, nextCursor };
  }
}

function mapTopicToStatus(topic: string): string {
  switch (topic) {
    case 'claim_filed':
      return 'pending';
    case 'claim_approved':
      return 'approved';
    case 'claim_pd':
    case 'claim_paid':
      return 'paid';
    case 'claim_rejected':
      return 'rejected';
    default:
      return topic.toLowerCase();
  }
}
