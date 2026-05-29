/**
 * Integration tests for policy expiry email and push notification templates.
 *
 * Mocks:
 *   - nodemailer transport (email provider)
 *   - fetch (push webhook)
 *   - NotificationPreferencesRepository (opt-in / opt-out)
 *
 * Covers:
 *   - Email and push sent for opted-in holder (en + es locales).
 *   - Opted-out users receive no notifications.
 *   - Template rendering verified for English and Spanish.
 */

import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications.service';
import {
  InMemoryNotificationPreferencesRepository,
  NOTIFICATION_PREFERENCES_REPOSITORY,
} from '../notification-preferences.repository';
import { PolicyExpiryEmailTemplate, PolicyExpiryPushTemplate } from '../notification.templates';

// ── Mock nodemailer ───────────────────────────────────────────────────────────

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

// ── Mock fetch ────────────────────────────────────────────────────────────────

const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
global.fetch = mockFetch as unknown as typeof fetch;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeService(pushWebhookUrl?: string): NotificationsService {
  const configMap: Record<string, unknown> = {
    SMTP_HOST: 'localhost',
    SMTP_PORT: 1025,
    SMTP_FROM: 'test@niffyinsure.local',
    PUSH_WEBHOOK_URL: pushWebhookUrl ?? '',
  };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => configMap[key] ?? fallback),
  } as unknown as ConfigService;

  const repo = new InMemoryNotificationPreferencesRepository();

  const service = new NotificationsService(configService, repo);
  // Inject repo via the DI token manually (constructor injection in tests).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any)[NOTIFICATION_PREFERENCES_REPOSITORY] = repo;
  return service;
}

const OPT_IN_HOLDER = 'GABC1234567890OPTIN';
const OPT_OUT_HOLDER = 'GABC1234567890OPTOUT';

const baseCtx = {
  policyId: 42,
  holderPublicKey: OPT_IN_HOLDER,
  expiryLedger: 500_000,
  timeToExpiry: '7 days',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PolicyExpiryEmailTemplate', () => {
  it('renders English subject and body with interpolated values', () => {
    const tmpl = PolicyExpiryEmailTemplate({ ...baseCtx, locale: 'en' });
    expect(tmpl.subject).toContain('7 days');
    expect(tmpl.text).toContain('42');
    expect(tmpl.text).toContain('500000');
    expect(tmpl.html).toContain('lang="en"');
    expect(tmpl.html).toContain('Policy Expiry Reminder');
  });

  it('renders Spanish subject and body with interpolated values', () => {
    const tmpl = PolicyExpiryEmailTemplate({ ...baseCtx, locale: 'es' });
    expect(tmpl.subject).toContain('7 days');
    expect(tmpl.html).toContain('lang="es"');
    expect(tmpl.html).toContain('Recordatorio de Vencimiento');
    expect(tmpl.text).toContain('42');
  });

  it('falls back to English for unknown locale', () => {
    const tmpl = PolicyExpiryEmailTemplate({ ...baseCtx, locale: 'fr' });
    expect(tmpl.html).toContain('lang="en"');
  });

  it('includes unsubscribe instruction', () => {
    const tmpl = PolicyExpiryEmailTemplate({ ...baseCtx });
    expect(tmpl.text).toContain('/notifications/preferences');
  });
});

describe('PolicyExpiryPushTemplate', () => {
  it('renders English push payload', () => {
    const push = PolicyExpiryPushTemplate({ ...baseCtx, locale: 'en' });
    expect(push.title).toContain('7 days');
    expect(push.body).toContain('42');
    expect(push.data.type).toBe('policy_expiry');
    expect(push.data.policyId).toBe(42);
  });

  it('renders Spanish push payload', () => {
    const push = PolicyExpiryPushTemplate({ ...baseCtx, locale: 'es' });
    expect(push.title).toContain('7 days');
    expect(push.body).toContain('vencerá');
  });
});

describe('NotificationsService.sendPolicyExpiryNotifications', () => {
  beforeEach(() => {
    mockSendMail.mockClear();
    mockFetch.mockClear();
  });

  it('sends email and push for opted-in holder', async () => {
    const service = makeService('https://push.example.com/webhook');
    const result = await service.sendPolicyExpiryNotifications(
      { ...baseCtx, holderPublicKey: OPT_IN_HOLDER },
      'holder@example.com',
    );
    expect(result.email).toBe('sent');
    expect(result.push).toBe('sent');
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://push.example.com/webhook');
    const body = JSON.parse(init.body as string) as { data: { type: string } };
    expect(body.data.type).toBe('policy_expiry');
  });

  it('skips email when no email address provided', async () => {
    const service = makeService('https://push.example.com/webhook');
    const result = await service.sendPolicyExpiryNotifications(
      { ...baseCtx, holderPublicKey: OPT_IN_HOLDER },
      undefined,
    );
    expect(result.email).toBe('skipped');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('skips push when PUSH_WEBHOOK_URL is not configured', async () => {
    const service = makeService(undefined);
    const result = await service.sendPolicyExpiryNotifications(
      { ...baseCtx, holderPublicKey: OPT_IN_HOLDER },
      'holder@example.com',
    );
    expect(result.push).toBe('skipped');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('opted-out holder receives no notifications', async () => {
    const service = makeService('https://push.example.com/webhook');
    // Opt out by setting renewalRemindersEnabled = false via the repository.
    await service.updateUserNotificationPreferences(OPT_OUT_HOLDER, {
      renewalRemindersEnabled: false,
    });
    const result = await service.sendPolicyExpiryNotifications(
      { ...baseCtx, holderPublicKey: OPT_OUT_HOLDER },
      'optout@example.com',
    );
    expect(result.email).toBe('skipped');
    expect(result.push).toBe('skipped');
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns failed status when email provider throws', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP error'));
    const service = makeService(undefined);
    const result = await service.sendPolicyExpiryNotifications(
      { ...baseCtx, holderPublicKey: OPT_IN_HOLDER },
      'holder@example.com',
    );
    expect(result.email).toBe('failed');
  });

  it('returns failed status when push webhook returns non-ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const service = makeService('https://push.example.com/webhook');
    const result = await service.sendPolicyExpiryNotifications(
      { ...baseCtx, holderPublicKey: OPT_IN_HOLDER },
      undefined,
    );
    expect(result.push).toBe('failed');
  });
});
