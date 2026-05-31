import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CaptchaService } from './captcha.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly captcha: CaptchaService,
    private readonly config: ConfigService,
  ) {}

  async submitTicket(dto: CreateTicketDto, remoteIp?: string) {
    const valid = await this.captcha.verify(dto.captchaToken, remoteIp);
    if (!valid) {
      throw new BadRequestException('CAPTCHA verification failed');
    }

    const ticket = await this.prisma.supportTicket.create({
      data: {
        email: dto.email.toLowerCase(),
        subject: dto.subject,
        message: dto.message,
        ipHash: remoteIp ? this.hashIp(remoteIp) : null,
      },
    });

    await this.notifyWebhook(ticket);

    this.logger.log(`Support ticket created: ${ticket.id}`);
    return this.mapToResponse(ticket);
  }

  async updateTicketStatus(ticketId: string, dto: UpdateTicketStatusDto, actor: string, ipAddress?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      throw new BadRequestException(`Ticket ${ticketId} not found`);
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: dto.status,
        updatedAt: new Date(),
      },
    });

    await this.prisma.adminAuditLog.create({
      data: {
        actor,
        action: 'support_ticket_status_updated',
        payload: {
          ticketId,
          from: ticket.status,
          to: dto.status,
          notes: dto.internalNotes ?? null,
          timestamp: new Date().toISOString(),
        },
        ipAddress,
      },
    });

    this.logger.log(`Support ticket ${ticketId} status updated from ${ticket.status} to ${dto.status}`);
    return this.mapToResponse(updated);
  }

  async getTicket(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      throw new BadRequestException(`Ticket ${ticketId} not found`);
    }
    return this.mapToResponse(ticket);
  }

  async listTickets(limit = 50, offset = 0) {
    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supportTicket.count(),
    ]);

    return {
      tickets: tickets.map((ticket) => this.mapToResponse(ticket)),
      total,
    };
  }

  async trackFaqExpansion(faqId: string) {
    // Privacy-safe: only increment a counter, no user data stored
    await this.prisma.faqStat.upsert({
      where: { faqId },
      update: { expansions: { increment: 1 } },
      create: { faqId, expansions: 1 },
    });
  }

  private async notifyWebhook(ticket: { id: string; email: string; subject: string; message: string; createdAt: Date }) {
    const webhookUrl = this.config.get<string>('SUPPORT_WEBHOOK_URL', '');
    if (!webhookUrl) {
      this.logger.debug('Support webhook URL not configured, skipping notification');
      return;
    }

    const payload = {
      event: 'support_ticket_created',
      ticketId: ticket.id,
      email: ticket.email,
      subject: ticket.subject,
      message: ticket.message,
      createdAt: ticket.createdAt.toISOString(),
    };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.logger.warn(`Support webhook returned ${response.status}`);
      }
    } catch (error) {
      this.logger.error(`Support webhook error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private hashIp(ip: string): string {
    return createHash('sha256')
      .update(ip + this.config.get<string>('IP_HASH_SALT', 'niff-salt'))
      .digest('hex');
  }

  private mapToResponse(ticket: any) {
    return {
      id: ticket.id,
      email: ticket.email,
      subject: ticket.subject,
      message: ticket.message,
      status: ticket.status,
      ipHash: ticket.ipHash,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    };
  }
}
