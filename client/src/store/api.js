import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { logout } from './authSlice';

const rawBaseQuery = fetchBaseQuery({
  baseUrl: '/api',
  prepareHeaders: (headers, { getState }) => {
    const token = getState().auth.token;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return headers;
  },
});

const baseQuery = async (args, api, extra) => {
  const result = await rawBaseQuery(args, api, extra);
  if (result.error?.status === 401 && !String(args.url || args).includes('auth/login')) api.dispatch(logout());
  return result;
};

/** Resource key used for cache tags: "leave/requests/3" -> "leave". */
export const rootOf = (path) => String(path).split(/[/?]/)[0];

// Cross-module dependencies: a write to the key also refreshes these caches.
const RELATED = {
  leave: ['attendance', 'approvals', 'dashboard', 'reports'],
  regularizations: ['attendance', 'approvals', 'dashboard'],
  attendance: ['dashboard', 'reports'],
  expenses: ['approvals', 'dashboard'],
  timesheets: ['approvals', 'projects', 'finance'],
  'tax-declarations': ['approvals'],
  employees: ['dashboard', 'departments', 'designations', 'locations', 'onboarding', 'reports', 'search', 'payroll'],
  candidates: ['jobs', 'employees', 'onboarding', 'dashboard', 'reports'],
  interviews: ['candidates'],
  onboarding: ['employees'],
  preboarding: ['onboarding', 'employees', 'candidates'],
  payroll: ['reports', 'dashboard'],
  kudos: ['dashboard'],
  announcements: ['dashboard'],
  enrollments: ['courses'],
  assets: ['employees', 'asset-requests', 'exit'],
  'asset-requests': ['approvals', 'assets', 'dashboard'],
  reviews: [],
  goals: ['dashboard'],
  resignations: ['exit', 'approvals', 'employees', 'onboarding', 'dashboard'],
  exit: ['resignations', 'employees', 'loans'],
  loans: ['approvals', 'payroll'],
  'attendance-requests': ['attendance', 'approvals', 'leave', 'dashboard'],
  travel: ['approvals', 'work'],
  workforce: ['attendance', 'leave'],
  hr: ['documents', 'letter-requests', 'employees', 'notifications'],
  'letter-requests': ['documents'],
  'letter-templates': ['documents'],
  'custom-fields': ['employees', 'auth'],
  companies: ['employees', 'payroll'],
  offers: ['candidates'],
  people: ['dashboard'],
  activity: ['productivity'],
  settings: ['approvals'],
  clients: ['projects', 'opportunities', 'finance'],
  projects: ['clients', 'resources', 'finance', 'timesheets'],
  opportunities: ['clients', 'projects'],
  resources: ['projects'],
  finance: ['projects', 'clients'],
  policies: ['leave', 'attendance', 'expenses', 'holidays', 'dashboard', 'calendar', 'workforce'],
  holidays: ['policies', 'attendance', 'leave', 'calendar', 'dashboard', 'workforce'],
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: ['R'],
  keepUnusedDataFor: 120,
  refetchOnReconnect: true,
  endpoints: (build) => ({
    // Generic cached GET for any resource path.
    get: build.query({
      query: ({ path, params }) => ({ url: path, params: params || undefined }),
      providesTags: (r, e, { path }) => [{ type: 'R', id: rootOf(path) }],
    }),
    // Generic write; invalidates the resource plus related modules so every view stays in sync.
    mutate: build.mutation({
      query: ({ path, method = 'POST', body }) => ({ url: path, method, body }),
      invalidatesTags: (r, e, { path, invalidates = [] }) => {
        const root = rootOf(path);
        return [root, ...(RELATED[root] || []), 'notifications', ...invalidates].map((id) => ({ type: 'R', id }));
      },
    }),
    login: build.mutation({ query: (body) => ({ url: 'auth/login', method: 'POST', body }) }),
  }),
});

export const { useGetQuery, useMutateMutation, useLoginMutation } = api;
