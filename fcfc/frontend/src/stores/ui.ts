// UI স্টেট — থিম, মডাল, টোস্ট, কল, ভিউয়ার, কনটেক্সট মেনু।
import { create } from 'zustand'

export interface MenuItem { label: string; danger?: boolean; onClick: () => void }

interface UiState {
  theme: 'light' | 'dark'
  panel: null | 'settings' | 'archived' | 'starred'
  modal: { type: string; props?: any } | null
  viewer: { urls: string[]; index: number; name?: string } | null
  call: { chatId: string; mode: 'audio' | 'video'; incoming?: any } | null
  menu: { x: number; y: number; items: MenuItem[] } | null
  toasts: { id: number; text: string }[]
  mobileView: 'list' | 'chat'

  toggleTheme(): void
  setPanel(p: UiState['panel']): void
  openModal(type: string, props?: any): void
  closeModal(): void
  openViewer(urls: string[], index?: number, name?: string): void
  closeViewer(): void
  setCall(c: UiState['call']): void
  openMenu(x: number, y: number, items: MenuItem[]): void
  closeMenu(): void
  toast(text: string): void
  setMobileView(v: UiState['mobileView']): void
}

let toastId = 0

export const useUi = create<UiState>((set, get) => ({
  theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  panel: null,
  modal: null,
  viewer: null,
  call: null,
  menu: null,
  toasts: [],
  mobileView: 'list',

  toggleTheme() {
    const t = get().theme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.toggle('dark', t === 'dark')
    localStorage.setItem('fcfc.theme', t)
    set({ theme: t })
  },
  setPanel(p) { set({ panel: p }) },
  openModal(type, props) { set({ modal: { type, props } }) },
  closeModal() { set({ modal: null }) },
  openViewer(urls, index = 0, name) { set({ viewer: { urls, index, name } }) },
  closeViewer() { set({ viewer: null }) },
  setCall(c) { set({ call: c }) },
  openMenu(x, y, items) { set({ menu: { x, y, items } }) },
  closeMenu() { set({ menu: null }) },
  toast(text) {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, text }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3200)
  },
  setMobileView(v) { set({ mobileView: v }) },
}))
