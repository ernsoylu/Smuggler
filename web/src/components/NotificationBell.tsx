import { useState, useRef, useEffect } from 'react';
import { Bell, X, Trash2 } from 'lucide-react';
import { useNotifications, type AppNotification, type NotificationType } from '../context/NotificationContext';

const TYPE_STYLES: Record<NotificationType, { dot: string; rowBg: string }> = {
  info:    { dot: 'bg-blue-400',    rowBg: 'bg-blue-500/5' },
  success: { dot: 'bg-emerald-400', rowBg: 'bg-emerald-500/5' },
  error:   { dot: 'bg-red-400',     rowBg: 'bg-red-500/5' },
  warning: { dot: 'bg-amber-400',   rowBg: 'bg-amber-500/5' },
};

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function NotificationItem({ n, onDismiss }: Readonly<{ n: AppNotification; onDismiss: () => void }>) {
  const { dot, rowBg } = TYPE_STYLES[n.type];
  return (
    <div className={`flex items-start gap-3 px-4 py-3 border-b border-white/5 last:border-0 transition-colors ${!n.read ? rowBg : 'hover:bg-white/[0.02]'}`}>
      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white leading-snug">{n.title}</p>
        {n.message && <p className="text-xs text-neutral-400 mt-0.5 leading-snug">{n.message}</p>}
        {n.progress && (
          <div className="mt-2 space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-semibold text-blue-400">{n.progress.label}</span>
              <span className="text-[10px] text-neutral-600">{n.progress.current + 1}/{n.progress.total}</span>
            </div>
            <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${((n.progress.current + 1) / n.progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
        <p className="text-[11px] text-neutral-600 mt-1">{timeAgo(n.timestamp)}</p>
      </div>
      <button
        onClick={onDismiss}
        className="mt-0.5 text-neutral-600 hover:text-neutral-400 transition-colors"
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markAllRead, dismiss, clearAll } = useNotifications();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const handleToggle = () => {
    setOpen(v => !v);
    if (!open && unreadCount > 0) markAllRead();
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleToggle}
        className="relative w-9 h-9 flex items-center justify-center rounded-xl text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-0.5 bg-blue-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <span className="text-sm font-semibold text-white">Notifications</span>
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors flex items-center gap-1"
              >
                <Trash2 size={12} /> Clear all
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-neutral-600">
                <Bell size={28} strokeWidth={1.5} />
                <p className="text-sm mt-2">No notifications</p>
              </div>
            ) : (
              notifications.map(n => (
                <NotificationItem key={n.id} n={n} onDismiss={() => dismiss(n.id)} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
