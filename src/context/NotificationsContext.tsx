import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getUnreadCount as loadUnreadFromStore, setUnreadCount as persistUnread } from '../utils/notifications';

export type NotificationsContextValue = {
  unreadCount: number;
  setUnreadCount: (n: number) => void;
};

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [unreadCount, setUnreadCountState] = useState<number>(0);

  useEffect(() => {
    let mounted = true;
    loadUnreadFromStore()
      .then(n => { if (mounted) setUnreadCountState(n); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const setUnreadCount = (n: number) => {
    setUnreadCountState(n);
    persistUnread(n).catch(() => {});
  };

  const value = { unreadCount, setUnreadCount };
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}