'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type NotificationChannel = 'in_app' | 'email' | 'push';

export interface AppNotification {
  id: string;
  title: string;
  body?: string;
  createdAt: string;
  read: boolean;
  channel?: NotificationChannel;
}

export interface NotificationBellProps {
  /** Optional initial notifications; when omitted the bell loads from the API. */
  initialNotifications?: AppNotification[];
  /** Optional loader override (useful for tests). */
  loadNotifications?: () => Promise<AppNotification[]>;
  /** Optional handler invoked when a notification is marked read. */
  onMarkRead?: (id: string) => void | Promise<void>;
  /** Optional handler invoked when all notifications are marked read. */
  onMarkAllRead?: () => void | Promise<void>;
}

async function defaultLoadNotifications(): Promise<AppNotification[]> {
  const res = await fetch('/api/notifications', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to load notifications (${res.status})`);
  }
  const data = (await res.json()) as { notifications?: AppNotification[] } | AppNotification[];
  return Array.isArray(data) ? data : data.notifications ?? [];
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

export default function NotificationBell({
  initialNotifications,
  loadNotifications,
  onMarkRead,
  onMarkAllRead,
}: NotificationBellProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>(initialNotifications ?? []);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(initialNotifications === undefined);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  useEffect(() => {
    if (initialNotifications !== undefined) return;
    let cancelled = false;
    const loader = loadNotifications ?? defaultLoadNotifications;
    setLoading(true);
    loader()
      .then((items) => {
        if (!cancelled) {
          setNotifications(items);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load notifications');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialNotifications, loadNotifications]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const markRead = useCallback(
    async (id: string) => {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      try {
        await onMarkRead?.(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update notification');
      }
    },
    [onMarkRead],
  );

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await onMarkAllRead?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update notifications');
    }
  }, [onMarkAllRead]);

  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        type="button"
        className="notification-bell__trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications'
        }
        onClick={() => setOpen((prev) => !prev)}
      >
        <span aria-hidden="true">🔔</span>
        {unreadCount > 0 && (
          <span className="notification-bell__badge" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notification-bell__dropdown" role="dialog" aria-label="Notifications">
          <div className="notification-bell__header">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead}>
                Mark all as read
              </button>
            )}
          </div>

          {error && (
            <p className="notification-bell__error" role="alert">
              {error}
            </p>
          )}

          {loading ? (
            <p className="notification-bell__empty">Loading…</p>
          ) : notifications.length === 0 ? (
            <p className="notification-bell__empty">You have no notifications.</p>
          ) : (
            <ul className="notification-bell__list">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={
                    notification.read
                      ? 'notification-bell__item'
                      : 'notification-bell__item notification-bell__item--unread'
                  }
                >
                  <button
                    type="button"
                    className="notification-bell__item-button"
                    onClick={() => {
                      if (!notification.read) void markRead(notification.id);
                    }}
                  >
                    <span className="notification-bell__item-title">{notification.title}</span>
                    {notification.body && (
                      <span className="notification-bell__item-body">{notification.body}</span>
                    )}
                    <span className="notification-bell__item-time">
                      {formatTimestamp(notification.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
