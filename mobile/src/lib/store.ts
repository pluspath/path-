import { create } from 'zustand';

interface PathStore {
  activeTab: number;
  setActiveTab: (tab: number) => void;
  lastSleepTimestamp: string | null;
  setLastSleepTimestamp: (ts: string | null) => void;
  isSleeping: boolean;
  setIsSleeping: (sleeping: boolean) => void;
  unreadCounts: Record<string, number>;
  setUnreadCounts: (counts: Record<string, number>) => void;
  incrementUnread: (convId: string) => void;
  clearUnread: (convId: string) => void;
}

export const usePathStore = create<PathStore>((set) => ({
  activeTab: 0,
  setActiveTab: (tab) => set({ activeTab: tab }),
  lastSleepTimestamp: null,
  setLastSleepTimestamp: (ts) => set({ lastSleepTimestamp: ts }),
  isSleeping: false,
  setIsSleeping: (sleeping) => set({ isSleeping: sleeping }),
  unreadCounts: {},
  setUnreadCounts: (counts) => set({ unreadCounts: counts }),
  incrementUnread: (convId) =>
    set((s) => ({ unreadCounts: { ...s.unreadCounts, [convId]: (s.unreadCounts[convId] ?? 0) + 1 } })),
  clearUnread: (convId) =>
    set((s) => ({ unreadCounts: { ...s.unreadCounts, [convId]: 0 } })),
}));
