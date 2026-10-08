import { create } from 'zustand';

import { LIMITS } from '@/config/limits';

export type ToastMessage = {
  message: string;
  tone?: 'default' | 'success' | 'error';
  /** 토스트 오른쪽 버튼 */
  action?: { label: string; onPress: () => void };
};

type ToastState = {
  toast: ToastMessage | null;
  show: (toast: ToastMessage) => void;
  hide: () => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;

/** 화면이 바뀌어도 이어지는 토스트 하나. 각 화면의 ToastSlot이 그린다 */
export const useToastStore = create<ToastState>((set) => ({
  toast: null,
  show: (toast) => {
    if (timer) clearTimeout(timer);
    set({ toast });
    timer = setTimeout(() => set({ toast: null }), LIMITS.toastDurationMs);
  },
  hide: () => {
    if (timer) clearTimeout(timer);
    set({ toast: null });
  },
}));

export const showToast = (toast: ToastMessage) => useToastStore.getState().show(toast);
