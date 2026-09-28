import { createSlice } from '@reduxjs/toolkit';

const load = () => {
  try {
    return JSON.parse(localStorage.getItem('auth')) || { token: null, user: null };
  } catch {
    return { token: null, user: null };
  }
};

const persist = (state) => {
  try {
    localStorage.setItem('auth', JSON.stringify({ token: state.token, user: state.user }));
  } catch { /* storage unavailable */ }
};

const authSlice = createSlice({
  name: 'auth',
  initialState: load(),
  reducers: {
    setCredentials(state, { payload }) {
      state.token = payload.token;
      state.user = payload.user;
      persist(state);
    },
    updateUser(state, { payload }) {
      state.user = { ...state.user, ...payload };
      persist(state);
    },
    logout(state) {
      state.token = null;
      state.user = null;
      persist(state);
    },
  },
});

export const { setCredentials, updateUser, logout } = authSlice.actions;
export default authSlice.reducer;
