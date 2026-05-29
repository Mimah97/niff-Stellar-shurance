import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../admin/audit.service';

export type PrivacyRequestType = 'ANONYMIZE' | 'DELETE';

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Open a privacy request ticket and immediately execute the procedure.
   * Returns the created PrivacyRequest record.
   *
   * IMMUTABILITY NOTE: on-chain policy/claim records and IPFS-pinned documents
   * cannot be erased. This procedure only affects mutable off-chain DB rows.
   */
  async handleRequest(opts: {
    subjectWalletAddress: string;
    requestType: PrivacyRequestType;
    requestedBy: string;
    ipAddress?: string;
    notes?: string;
  }): Promise<{ requestId: string; rowsAffected: number }> {
    const request = await this.prisma.privacyRequest.create({
      data: {
        subjectWalletAddress: opts.subjectWalletAddress,
        requestType: opts.requestType,
        requestedBy: opts.requestedBy,
        notes: opts.notes,
        status: 'IN_PROGRESS',
      },
    });

    let rowsAffected = 0;
    let status: 'COMPLETED' | 'FAILED' = 'COMPLETED';
    let errorMessage: string | undefined;

    try {
      rowsAffected =
        opts.requestType === 'ANONYMIZE'
          ? await this.anonymize(opts.subjectWalletAddress)
          : await this.delete(opts.subjectWalletAddress);
    } catch (err) {
      status = 'FAILED';
      errorMessage = (err as Error).message;
      this.logger.error(`Privacy ${opts.requestType} failed for ${opts.subjectWalletAddress}: ${errorMessage}`);
    }

    await this.prisma.privacyRequest.update({
      where: { id: request.id },
      data: { status, rowsAffected, errorMessage, completedAt: new Date() },
    });

    await this.audit.write({
      actor: opts.requestedBy,
      action: `privacy_${opts.requestType.toLowerCase()}`,
      payload: {
        requestId: request.id,
        subjectWalletAddress: opts.subjectWalletAddress,
        rowsAffected,
        status,
        ...(errorMessage ? { errorMessage } : {}),
      },
      ipAddress: opts.ipAddress,
    });

    if (status === 'FAILED') throw new Error(`Privacy request failed: ${errorMessage}`);

    await this.notifyStaff(opts.requestedBy, request.id, opts.subjectWalletAddress, rowsAffected);

    return { requestId: request.id, rowsAffected };
  }

  /**
   * Process a privacy request by ID (idempotent).
   * Re-running on an already-COMPLETED request returns the existing result without re-processing.
   */
  async processRequest(requestId: string): Promise<{ requestId: string; rowsAffected: number }> {
    const req = await this.prisma.privacyRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException(`Privacy request ${requestId} not found`);

    // Idempotent: already completed — return existing result without re-processing
    if (req.status === 'COMPLETED') {
      return { requestId: req.id, rowsAffected: req.rowsAffected };
    }

    let rowsAffected = 0;
    let status: 'COMPLETED' | 'FAILED' = 'COMPLETED';
    let errorMessage: string | undefined;

    try {
      rowsAffected =
        req.requestType === 'ANONYMIZE'
          ? await this.anonymize(req.subjectWalletAddress)
          : await this.delete(req.subjectWalletAddress);
    } catch (err) {
      status = 'FAILED';
      errorMessage = (err as Error).message;
      this.logger.error(`processRequest ${requestId} failed: ${errorMessage}`);
    }

    await this.prisma.privacyRequest.update({
      where: { id: requestId },
      data: { status, rowsAffected, errorMessage, completedAt: new Date() },
    });

    if (status === 'FAILED') throw new Error(`Privacy request failed: ${errorMessage}`);

    await this.notifyStaff(req.requestedBy, requestId, req.subjectWalletAddress, rowsAffected);

    return { requestId, rowsAffected };
  }

  /**
   * Replace PII fields with redacted placeholders.
   * - SupportTicket.email → SHA-256 hash
   * - Claim.description → '[redacted]', imageUrls → []
   */
  private async anonymize(walletAddress: string): Promise<number> {
    const hashEmail = (email: string) =>
      createHash('sha256').update(email).digest('hex');

    const tickets = await this.prisma.supportTicket.findMany({
      where: { email: { not: { startsWith: '[redacted]' } } },
      select: { id: true, email: true },
    });

    const ticketUpdates = tickets
      .filter((t) => t.email === walletAddress || t.email.includes(walletAddress))
      .map((t) =>
        this.prisma.supportTicket.update({
          where: { id: t.id },
          data: { email: hashEmail(t.email) },
        }),
      );

    const results = await this.prisma.$transaction([
      this.prisma.claim.updateMany({
        where: { creatorAddress: walletAddress, deletedAt: null, description: { not: null } },
        data: { description: '[redacted]', imageUrls: [] },
      }),
      ...ticketUpdates,
    ]);

    return results.reduce((sum, r) => sum + ('count' in r ? r.count : 1), 0);
  }

  /**
   * Hard-delete mutable off-chain rows for the subject.
   * Votes and raw events are retained for audit integrity.
   */
  private async delete(walletAddress: string): Promise<number> {
    const results = await this.prisma.$transaction([
      this.prisma.claim.deleteMany({
        where: { creatorAddress: walletAddress, isFinalized: false, deletedAt: null },
      }),
    ]);
    return results.reduce((sum, r) => sum + r.count, 0);
  }

  private async notifyStaff(
    staffEmail: string,
    requestId: string,
    subject: string,
    rowsAffected: number,
  ): Promise<void> {
    const smtpHost = this.config.get<string>('SMTP_HOST');
    if (!smtpHost) return;

    try {
      const transport = nodemailer.createTransport({
        host: smtpHost,
        port: this.config.get<number>('SMTP_PORT', 1025),
        secure: false,
      });
      await transport.sendMail({
        from: this.config.get<string>('SMTP_FROM', 'noreply@niffyinsur.io'),
        to: staffEmail,
        subject: `Privacy request ${requestId} completed`,
        text: `Privacy request ${requestId} for subject ${subject} completed. Rows affected: ${rowsAffected}.`,
      });
    } catch (err) {
      this.logger.warn(`Staff notification failed for request ${requestId}: ${(err as Error).message}`);
    }
  }

  async getRequest(requestId: string) {
    const req = await this.prisma.privacyRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException(`Privacy request ${requestId} not found`);
    return req;
  }

  async listRequests(page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.prisma.privacyRequest.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.privacyRequest.count(),
    ]);
    return { items, total, page, limit };
  }
}
