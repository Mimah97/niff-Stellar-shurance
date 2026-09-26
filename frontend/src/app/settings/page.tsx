import type { Metadata } from 'next'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { NotificationBell } from '@/components/settings/notification-bell'

export const metadata: Metadata = {
  title: 'Settings — NiffyInsur',
}

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <NotificationBell />
      </div>
      <SettingsPanel />
    </main>
  )
}
