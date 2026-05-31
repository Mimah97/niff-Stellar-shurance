import { SupportService } from '../support.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CaptchaService } from '../captcha.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';

const mockTicket = {
  id: 'uuid-1',
  email: 'user@example.com',
  subject: 'Test subject',
  message: 'Test message body here',
  status: 'OPEN',
  ipHash: 'hash',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePrisma(ticket = mockTicket) {
  return {
    supportTicket: {
      create: jest.fn().mockResolvedValue(ticket),
      findUnique: jest.fn().mockResolvedValue(ticket),
      update: jest.fn().mockResolvedValue({ ...ticket, status: 'RESOLVED' }),
      findMany: jest.fn().mockResolvedValue([ticket]),
      count: jest.fn().mockResolvedValue(1),
    },
    adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
    faqStat: { upsert: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;
}

function makeCaptcha(valid = true) {
  return { verify: jest.fn().mockResolvedValue(valid) } as unknown as CaptchaService;
}

function makeConfig() {
  return {
    get: jest.fn().mockImplementation((key: string, def?: string) => def ?? ''),
  } as unknown as ConfigService;
}

describe('SupportService', () => {
  it('creates ticket when CAPTCHA passes', async () => {
    const prisma = makePrisma();
    const svc = new SupportService(prisma, makeCaptcha(true), makeConfig());
    const result = await svc.submitTicket(
      { email: 'user@example.com', subject: 'Test', message: 'Hello world', captchaToken: 'tok' },
      '1.2.3.4',
    );
    expect(result.id).toBe('uuid-1');
    expect(prisma.supportTicket.create).toHaveBeenCalled();
  });

  it('rejects ticket when CAPTCHA fails', async () => {
    const svc = new SupportService(makePrisma(), makeCaptcha(false), makeConfig());
    await expect(
      svc.submitTicket(
        { email: 'user@example.com', subject: 'Test', message: 'Hello', captchaToken: 'bad' },
        '1.2.3.4',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('stores hashed IP, not raw IP', async () => {
    const prisma = makePrisma();
    const svc = new SupportService(prisma, makeCaptcha(true), makeConfig());
    await svc.submitTicket(
      { email: 'user@example.com', subject: 'Test', message: 'Hello world', captchaToken: 'tok' },
      '1.2.3.4',
    );
    const createCall = (prisma.supportTicket.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.ipHash).toBeDefined();
    expect(createCall.data.ipHash).not.toBe('1.2.3.4');
  });

  it('updateTicketStatus writes audit log', async () => {
    const prisma = makePrisma();
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig());
    await svc.updateTicketStatus('uuid-1', { status: 'RESOLVED' }, 'GADMIN');
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'support_ticket_status_updated' }),
      }),
    );
  });

  it('updateTicketStatus throws when ticket not found', async () => {
    const prisma = makePrisma();
    (prisma.supportTicket.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig());
    await expect(svc.updateTicketStatus('bad-id', { status: 'RESOLVED' }, 'GADMIN')).rejects.toThrow(
      BadRequestException,
    );
  });
});
