import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type NotificationType = 'info' | 'success' | 'error' | 'warning';

export interface NotificationProgress {
  current: number;
  total: number;
  label: string;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  timestamp: number;
  read: boolean;
  progress?: NotificationProgress;
}

type NotificationPatch = Partial<Pick<AppNotification, 'type' | 'title' | 'message' | 'progress'>>;

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  push: (n: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => string;
  update: (id: string, patch: NotificationPatch) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const push = useCallback((n: Omit<AppNotification, 'id' | 'timestamp' | 'read'>): string => {
    const entry: AppNotification = {
      ...n,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      read: false,
    };
    setNotifications(prev => [entry, ...prev].slice(0, 100));
    return entry.id;
  }, []);

  const update = useCallback((id: string, patch: NotificationPatch) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, push, update, markAllRead, dismiss, clearAll }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
