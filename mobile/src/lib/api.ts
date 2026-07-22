import { fetch } from 'expo/fetch';
import { supabase } from './supabase';

const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL!;

async function request<T>(url: string, options: { method?: string; body?: string } = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const response = await fetch(`${baseUrl}${url}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Request failed' } }));
    throw new Error(error?.error?.message ?? `HTTP ${response.status}`);
  }

  if (response.status === 204) return null as T;

  const json = await response.json();
  return ('data' in json ? json.data : json) as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: any) =>
    request<T>(url, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(url: string, body?: any) =>
    request<T>(url, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T = void>(url: string) => request<T>(url, { method: 'DELETE' }),
  patch: <T>(url: string, body?: any) =>
    request<T>(url, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
};
