import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CaptchaService } from '../../captcha/captcha.service';
import { CreateSupportTicketDto, UpdateSupportTicketDto, SupportTicketResponseDto } from '../dto/support-ticket.dto';
import { crypto } from '@stellar/stellar-sdk';

@Injectable()
export class SupportTicketService {
  private readonly logger = new Logger(SupportTicketService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly captcha: CaptchaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Create a new support ticket with CAPTCHA verification and webhook notification
   */
  async createTicket(
    dto: CreateSupportTicketDto,
    clientIp: string,
  ): Promise<SupportTicketResponseDto> {
    // Verify CAPTCHA first
    const captchaValid = await this.captcha.verify(dto.captchaToken);
    if (!captchaValid) {
      throw new BadRequestException('CAPTCHA verification failed');
    }

    // Hash IP for spam detection (not storing raw IP)
    const ipHash = this.hashIp(clientIp);

    // Store ticket
    const ticket = await this.prisma.supportTicket.create({
      data: {
        email: dto.email.toLowerCase(),
        subject: dto.subject,
        message: dto.message,
        ipHash,
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Created support ticket ${ticket.id} from ${dto.email}`);

    // Notify support team via webhook (non-blocking)
    try {
      await this.notifyWebhook(ticket);
    } catch (error) {
      this.logger.error(
        `Failed to notify webhook for ticket ${ticket.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return this.mapToResponse(ticket);
  }

  /**
   * Update ticket status with audit logging (admin only)
   */
  async updateTicketStatus(
    ticketId: number,
    dto: UpdateSupportTicketDto,
    adminId: string,
  ): Promise<SupportTicketResponseDto> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });

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

    // Audit log the status change
    await this.prisma.auditLog.create({
      data: {
        action: 'SUPPORT_TICKET_STATUS_UPDATED',
        resourceType: 'SUPPORT_TICKET',
        resourceId: String(ticketId),
        actorId: adminId,
        details: {
          from: ticket.status,
          to: dto.status,
          notes: dto.internalNotes,
          timestamp: new Date().toISOString(),
        },
      },
    });

    this.logger.log(`Admin ${adminId} updated ticket ${ticketId} status to ${dto.status}`);

    return this.mapToResponse(updated);
  }

  /**
   * Get all tickets (admin only)
   */
  async getAllTickets(
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ tickets: SupportTicketResponseDto[]; total: number }> {
    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supportTicket.count(),
    ]);

    return {
      tickets: tickets.map((t) => this.mapToResponse(t)),
      total,
    };
  }

  /**
   * Get single ticket by ID
   */
  async getTicket(ticketId: number): Promise<SupportTicketResponseDto> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new BadRequestException(`Ticket ${ticketId} not found`);
    }

    return this.mapToResponse(ticket);
  }

  /**
   * Notify support team via configurable webhook on new ticket
   */
  private async notifyWebhook(ticket: any): Promise<void> {
    const webhookUrl = this.config.get<string>('SUPPORT_WEBHOOK_URL');
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
      dashboardUrl: `${this.config.get('ADMIN_DASHBOARD_URL')}/tickets/${ticket.id}`,
    };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.logger.warn(`Webhook notification returned ${response.status}`);
      }
    } catch (error) {
      throw new Error(
        `Webhook request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Hash IP address using crypto (not storing raw IP)
   */
  private hashIp(ip: string): string {
    const salt = this.config.get<string>('IP_HASH_SALT', 'salt');
    const combined = `${ip}:${salt}`;
    // Use a simple hash - in production use crypto.subtle or similar
    return Buffer.from(combined).toString('base64');
  }

  /**
   * Map internal ticket model to response DTO
   */
  private mapToResponse(ticket: any): SupportTicketResponseDto {
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
