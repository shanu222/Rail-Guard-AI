'use client';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import { WS_URL, getToken } from './api';
import { useAuth } from './auth';

export interface LiveEvent {
  id: string;
  type: 'detection.severe' | 'crossing.warning' | 'device.offline' | 'risk.updated';
  at: string;
  data: Record<string, any>;
}
const Ctx = createContext<{
  events: LiveEvent[];
  toast: LiveEvent | null;
  dismiss: () => void;
  connected: boolean;
}>({ events: [], toast: null, dismiss: () => {}, connected: false });

/** Socket.IO feed: SEGMENT risk updates refresh data; severe/crossing/offline events appear as alerts. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [toast, setToast] = useState<LiveEvent | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user) return;
    const socket = io(WS_URL, {
      auth: (cb) => cb({ token: getToken() }),
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 15000,
    });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    for (const type of [
      'detection.severe',
      'crossing.warning',
      'device.offline',
      'risk.updated',
    ] as const) {
      socket.on(type, (data: Record<string, any>) => {
        const ev: LiveEvent = { id: crypto.randomUUID(), type, at: new Date().toISOString(), data };
        if (type === 'risk.updated') {
          void qc.invalidateQueries({ queryKey: ['segments'] });
          void qc.invalidateQueries({ queryKey: ['overview'] });
          return;
        }
        setEvents((e) => [ev, ...e].slice(0, 30));
        setToast(ev);
        void qc.invalidateQueries({ queryKey: ['overview'] });
        if (type === 'device.offline') void qc.invalidateQueries({ queryKey: ['devices'] });
      });
    }
    return () => {
      socket.close();
    };
  }, [user, qc]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <Ctx.Provider value={{ events, toast, dismiss: () => setToast(null), connected }}>
      {children}
    </Ctx.Provider>
  );
}
export const useLive = () => useContext(Ctx);
