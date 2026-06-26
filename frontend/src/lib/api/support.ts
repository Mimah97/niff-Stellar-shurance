import { getConfig } from '@/config/env';

const { apiUrl: API_BASE_URL } = getConfig();

export interface TicketPayload {
  email: string;
  subject: string;
  message: string;
  captchaToken: string;
}

export async function submitSupportTicket(payload: TicketPayload): Promise<{ id: string; status: string }> {
  const res = await fetch(`${API_BASE_URL}/api/support/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to submit ticket');
  }

  return res.json();
}

export async function trackFaqExpansion(faqId: string): Promise<void> {
  // Fire-and-forget — don't block the UI
  fetch(`${API_BASE_URL}/api/support/faq/${faqId}/expand`, { method: 'POST' }).catch(() => {});
}

// ── FAQ management (admin) ──────────────────────────────────────────────────

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  category: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

function adminHeaders(jwt: string) {
  return { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
}

export async function listFaqItems(): Promise<FaqItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/support/faq`);
  if (!res.ok) throw new Error(`Failed to fetch FAQ items: ${res.status}`);
  return res.json();
}

export async function createFaqItem(
  jwt: string,
  data: { question: string; answer: string; category?: string },
): Promise<FaqItem> {
  const res = await fetch(`${API_BASE_URL}/api/support/faq`, {
    method: 'POST',
    headers: adminHeaders(jwt),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message || 'Failed to create FAQ item');
  }
  return res.json();
}

export async function updateFaqItem(
  jwt: string,
  id: string,
  data: Partial<{ question: string; answer: string; category: string; displayOrder: number }>,
): Promise<FaqItem> {
  const res = await fetch(`${API_BASE_URL}/api/support/faq/${id}`, {
    method: 'PATCH',
    headers: adminHeaders(jwt),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message || 'Failed to update FAQ item');
  }
  return res.json();
}

export async function deleteFaqItem(jwt: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/support/faq/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(jwt),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message || 'Failed to delete FAQ item');
  }
}

export async function reorderFaqItems(
  jwt: string,
  items: Array<{ id: string; displayOrder: number }>,
): Promise<FaqItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/support/faq/reorder`, {
    method: 'PATCH',
    headers: adminHeaders(jwt),
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message || 'Failed to reorder FAQ items');
  }
  return res.json();
}
