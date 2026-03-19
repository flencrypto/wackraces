import { useAuthStore } from '../store/auth'

const BASE = '/api/v1'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

// Auth API
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ accessToken: string; refreshToken: string; user: { sub: string; email: string; role: string } }>('/auth/login', { email, password }),
  register: (email: string, password: string, role: string) =>
    api.post<{ accessToken: string; refreshToken: string; user: { sub: string; email: string; role: string } }>('/auth/register', { email, password, role }),
}

// Events API
export interface Car {
  id: string
  car_number: string
  team_name?: string
  display_name?: string
  avatar_url?: string
  last_lat?: number | null
  last_lng?: number | null
  last_ts?: string
  status?: string
  sharing_mode?: string
}

export interface Post {
  id: string
  caption?: string
  media: { url: string; type: string }[]
  city_label?: string
  car_id: string
  created_at: string
  reactions?: Record<string, number>
}

export const eventsApi = {
  getCars: (eventId: string) => api.get<Car[]>(`/events/${eventId}/cars`),
  getFeed: (eventId: string, page = 1) => api.get<Post[]>(`/events/${eventId}/feed?page=${page}`),
}
