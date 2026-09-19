import { useEffect, useState } from 'react';

const STORAGE_KEY = 'bettracker-notifications-enabled';
const SUPPORTED = typeof window !== 'undefined' && 'Notification' in window;

export function useNotificationPreference() {
  const [permission, setPermission] = useState(SUPPORTED ? Notification.permission : 'unsupported');
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // localStorage kan geblokkeerd zijn (bv. privémodus) - voorkeur onthouden we dan niet, geen probleem.
    }
  }, [enabled]);

  async function requestPermission() {
    if (!SUPPORTED) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') setEnabled(true);
  }

  return { permission, enabled, setEnabled, requestPermission };
}

export default function NotificationToggle({ permission, enabled, setEnabled, requestPermission }) {
  if (permission === 'unsupported') return null;

  if (permission === 'denied') {
    return (
      <button type="button" className="btn notif-btn" disabled title="Geblokkeerd in de browser-instellingen">
        🔕 Notificaties geblokkeerd
      </button>
    );
  }

  if (permission !== 'granted') {
    return (
      <button type="button" className="btn notif-btn" onClick={requestPermission}>
        🔔 Notificaties aanzetten
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`btn notif-btn ${enabled ? 'is-active' : ''}`}
      onClick={() => setEnabled((v) => !v)}
      title={enabled ? 'Klik om te pauzeren' : 'Klik om te hervatten'}
    >
      {enabled ? '🔔 Notificaties aan' : '🔕 Notificaties gepauzeerd'}
    </button>
  );
}
