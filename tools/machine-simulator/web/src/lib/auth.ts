/**
 * WS-D-D6 — auth context: tracks the current cookie-session user (`GET /v1/auth/me`), exposes
 * login/logout, and a bootstrap-status/bootstrap pair the App-level gate (`App.tsx`) uses to decide
 * whether to render `<Bootstrap/>`, `<Login/>`, or the normal Shell/routes tree. Modeled on
 * `FleetRuntimeProvider` (`lib/api.ts`) — a plain React context wired to TanStack Query, same idiom,
 * same file shape (`.ts`, not `.tsx` — `React.createElement` instead of JSX, matching that file's own
 * convention).
 *
 * `/v1/auth/me` returning 401 is this app's single most load-bearing "expected, not exceptional"
 * response: every visitor who hasn't logged in yet gets exactly one on first load, and the whole
 * point of this file is to turn that into `user: null` (→ render `<Login/>`) rather than a thrown
 * query error. `fetchMe` below therefore does its OWN raw `fetch` instead of going through
 * `lib/api.ts`'s shared `request<T>` — that helper's `onUnauthorized` hook (registered by
 * `AuthProvider` further down) is for a DIFFERENT case: a query that assumed it already had a session
 * (fleet/machine/settings/…) suddenly getting rejected mid-use. Routing THIS query's own routine
 * "no session yet" 401 through that same hook would invalidate `["auth","me"]`, which — because this
 * very query is what `AuthProvider` mounts unconditionally — would immediately refetch, 401 again, and
 * invalidate again: an infinite request loop for the ordinary logged-out case. Bypassing it here is
 * what keeps that hook safe to fire unconditionally everywhere else.
 */
import * as React from "react"
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query"

import { BASE_URL, EngineApiError, onUnauthorized } from "@/lib/api"

export interface AuthUser {
  username: string
  role: string
  displayName: string | null
}

interface BootstrapStatus {
  needsBootstrap: boolean
}

export interface BootstrapInput {
  username: string
  password: string
  displayName?: string
}

interface RawAuthUserDto {
  username: string
  role: string
  displayName?: string | null
}

function toAuthUser(dto: RawAuthUserDto): AuthUser {
  return { username: dto.username, role: dto.role, displayName: dto.displayName ?? null }
}

/** `GET /v1/auth/me` — 401 (no session) resolves to `null`, a normal successful result, not a thrown
 * error (see this file's own top comment for why that distinction matters). Any OTHER non-2xx (a
 * genuine engine/network problem) still throws, same as every other fetcher in this codebase. */
async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch(`${BASE_URL}/v1/auth/me`, { credentials: "include" })
  if (res.status === 401) return null
  if (!res.ok) throw new EngineApiError("GET", "/v1/auth/me", res.status)
  return toAuthUser((await res.json()) as RawAuthUserDto)
}

/** `GET /v1/auth/bootstrap-status` — `AllowAnonymous`, always 200 (see `AuthEndpoints.cs`), so no
 * 401 special-casing is needed here the way `fetchMe` above needs it. */
async function fetchBootstrapStatus(): Promise<BootstrapStatus> {
  const res = await fetch(`${BASE_URL}/v1/auth/bootstrap-status`, { credentials: "include" })
  if (!res.ok) throw new EngineApiError("GET", "/v1/auth/bootstrap-status", res.status)
  return (await res.json()) as BootstrapStatus
}

async function postLogin(username: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${BASE_URL}/v1/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
  // 401 here is the ordinary "wrong username/password" outcome `Login.tsx` shows inline — never
  // routed through the app-wide `onUnauthorized` bounce-to-Login reaction (there's nowhere further to
  // bounce; the caller is already ON the Login screen).
  if (!res.ok) throw new EngineApiError("POST", "/v1/auth/login", res.status)
  return toAuthUser((await res.json()) as RawAuthUserDto)
}

async function postLogout(): Promise<void> {
  const res = await fetch(`${BASE_URL}/v1/auth/logout`, { method: "POST", credentials: "include" })
  if (!res.ok) throw new EngineApiError("POST", "/v1/auth/logout", res.status)
}

async function postBootstrap(input: BootstrapInput): Promise<AuthUser> {
  const res = await fetch(`${BASE_URL}/v1/auth/bootstrap`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new EngineApiError("POST", "/v1/auth/bootstrap", res.status)
  return toAuthUser((await res.json()) as RawAuthUserDto)
}

const AUTH_ME_QUERY_KEY = ["auth", "me"] as const
const BOOTSTRAP_STATUS_QUERY_KEY = ["auth", "bootstrap-status"] as const

export interface AuthContextValue {
  user: AuthUser | null
  /** True only while the very first `/v1/auth/me` round trip is in flight — the App-level gate shows
   * a themed splash for exactly this long, then commits to Bootstrap/Login/Shell. */
  isLoading: boolean
  login: (username: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  refetch: () => Promise<unknown>
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()

  const meQuery = useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: fetchMe,
    // A 401 is swallowed to `null` inside `fetchMe` itself (see its own doc comment) — this only
    // covers the rare case of a genuine network/engine error, where retrying a handful of times before
    // giving up matches every other bootstrap-time query in this app (`App.tsx`'s `QueryClientProvider`
    // default is `retry: 2`; spelled out explicitly here since the brief calls it out and this is the
    // one query where "give up fast" vs. "retry like everything else" is a real behavioral choice, not
    // an accident of the shared default).
    retry: false,
  })

  // Any OTHER query anywhere in the app (fleet/machine/settings/scenario/…) that hits a 401 — a
  // session that expired, or was revoked by a password/role/disable change mid-session — invalidates
  // this SAME query, which refetches, resolves to `user: null`, and flips the App-level gate to
  // `<Login/>`. Re-registering on every render is harmless (the registry is a single overwritten
  // slot, not a list — see `onUnauthorized`'s own doc comment) and keeps this closure's `queryClient`
  // reference always current.
  React.useEffect(() => {
    onUnauthorized(() => {
      queryClient.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY })
    })
  }, [queryClient])

  const login = React.useCallback(
    async (username: string, password: string) => {
      const user = await postLogin(username, password)
      // Written straight into the cache (not just invalidated) — the caller (Login.tsx) awaits this
      // and immediately needs `useAuth().user` to already reflect the freshly-signed-in account on
      // the very next render, not one refetch-round-trip later.
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, user)
      return user
    },
    [queryClient]
  )

  const logout = React.useCallback(async () => {
    await postLogout()
    queryClient.setQueryData(AUTH_ME_QUERY_KEY, null)
  }, [queryClient])

  const refetch = React.useCallback(async () => {
    await meQuery.refetch()
  }, [meQuery])

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data ?? null,
      isLoading: meQuery.isLoading,
      login,
      logout,
      refetch,
    }),
    [meQuery.data, meQuery.isLoading, login, logout, refetch]
  )

  return React.createElement(AuthContext.Provider, { value }, children)
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>")
  return ctx
}

/** `GET /v1/auth/bootstrap-status` — the App-level gate's FIRST check (ahead of `user == null`):
 * a fresh, never-bootstrapped deployment shows `<Bootstrap/>` regardless of whether `/v1/auth/me`
 * also came back logged-out, so an operator is never asked to "log in" to an account that doesn't
 * exist yet. */
export function useBootstrapStatus(): UseQueryResult<BootstrapStatus> {
  return useQuery({
    queryKey: BOOTSTRAP_STATUS_QUERY_KEY,
    queryFn: fetchBootstrapStatus,
  })
}

/** `POST /v1/auth/bootstrap` — creates the first Admin account and signs it in, same shape as every
 * other mutation hook in `lib/api.ts`. On success, writes the new session straight into `["auth","me"]`
 * (so the gate flips past `<Login/>` too, straight to the Shell — bootstrap already established a
 * session server-side, see `AuthEndpoints.cs`) and invalidates the bootstrap-status query (defensive —
 * `Bootstrap.tsx` navigates away immediately after, but a future caller re-rendering this screen
 * shouldn't see a stale `needsBootstrap: true`). */
export function useBootstrap() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: postBootstrap,
    onSuccess: (user) => {
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, user)
      queryClient.invalidateQueries({ queryKey: BOOTSTRAP_STATUS_QUERY_KEY })
    },
  })
}
