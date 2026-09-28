import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { api } from './api';
import auth, { logout } from './authSlice';
import ui from './uiSlice';

export const store = configureStore({
  reducer: { [api.reducerPath]: api.reducer, auth, ui },
  middleware: (getDefault) => getDefault().concat(api.middleware),
});

// Drop every cached response when the user signs out so the next account never sees stale data.
// The marker is updated before dispatching, since dispatch re-enters this subscriber synchronously.
let lastToken = store.getState().auth.token;
store.subscribe(() => {
  const token = store.getState().auth.token;
  if (token === lastToken) return;
  const signedOut = !token && lastToken;
  lastToken = token;
  if (signedOut) store.dispatch(api.util.resetApiState());
});

setupListeners(store.dispatch);
export { logout };
