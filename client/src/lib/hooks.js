import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useGetQuery, useMutateMutation } from '../store/api';
import { pushToast } from '../store/uiSlice';

/** Cached GET. Returns { data, isLoading, isFetching, error, refetch }. */
export function useGet(path, params, options = {}) {
  const cleaned = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null)) : undefined;
  return useGetQuery({ path, params: cleaned }, { skip: !path || options.skip, pollingInterval: options.poll, refetchOnMountOrArgChange: options.fresh ? true : 60 });
}

export function useToast() {
  const dispatch = useDispatch();
  return useCallback((message, type = 'success') => dispatch(pushToast({ message, type })), [dispatch]);
}

/**
 * Returns [run, state]. run(path, { method, body, success, invalidates }) performs the write,
 * shows a toast and resolves to the response (or null on error).
 */
export function useAction() {
  const [mutate, state] = useMutateMutation();
  const toast = useToast();
  const run = useCallback(async (path, { method = 'POST', body, success, invalidates } = {}) => {
    try {
      const res = await mutate({ path, method, body, invalidates }).unwrap();
      if (success) toast(success);
      return res ?? {};
    } catch (err) {
      toast(err?.data?.error || 'Request failed, please try again', 'error');
      return null;
    }
  }, [mutate, toast]);
  return [run, state];
}

export function useAuth() {
  const user = useSelector((s) => s.auth.user);
  return useMemo(() => {
    const role = user?.role;
    return {
      user,
      role,
      isAdmin: role === 'admin',
      isHR: role === 'admin' || role === 'hr',
      isManager: role === 'manager' || role === 'admin' || role === 'hr',
    };
  }, [user]);
}

export function useDebounced(value, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial);
  const [payload, setPayload] = useState(null);
  return {
    open,
    payload,
    onOpen: (p = null) => { setPayload(p); setOpen(true); },
    onClose: () => { setOpen(false); setPayload(null); },
  };
}
