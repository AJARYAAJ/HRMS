import { createSlice, nanoid } from '@reduxjs/toolkit';

const initialTheme = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

const uiSlice = createSlice({
  name: 'ui',
  initialState: { theme: initialTheme(), sidebarOpen: false, sidebarCollapsed: false, toasts: [], paletteOpen: false },
  reducers: {
    toggleTheme(state) {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', state.theme === 'dark');
      try { localStorage.setItem('theme', state.theme); } catch { /* ignore */ }
    },
    setSidebarOpen(state, { payload }) { state.sidebarOpen = payload; },
    toggleCollapsed(state) { state.sidebarCollapsed = !state.sidebarCollapsed; },
    setPaletteOpen(state, { payload }) { state.paletteOpen = payload; },
    pushToast: {
      reducer(state, { payload }) { state.toasts.push(payload); },
      prepare(toast) { return { payload: { id: nanoid(), type: 'success', ...toast } }; },
    },
    dismissToast(state, { payload }) { state.toasts = state.toasts.filter((t) => t.id !== payload); },
  },
});

export const { toggleTheme, setSidebarOpen, toggleCollapsed, setPaletteOpen, pushToast, dismissToast } = uiSlice.actions;
export default uiSlice.reducer;
