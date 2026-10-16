/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { Route } from '@/routes/auth.oidc.start'
import { useAuthStore } from '@/stores/auth-store'

const provider = {
  id: 1,
  name: 'IDONE',
  slug: 'idone',
  icon: '',
  client_id: 'fixture-client',
  authorization_endpoint: 'https://idone.example/oauth/authorize',
  scopes: 'openid profile',
}
let statusFailure = false
let flowFailure = false
let providers = [provider]
let requests: string[] = []
let queryClient: QueryClient

function setupRouter(path = '/auth/oidc/start?provider=idone') {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: Outlet,
  })
  const start = Route.update({
    id: '/auth/oidc/start',
    path: '/auth/oidc/start',
    getParentRoute: () => root,
  } as Parameters<typeof Route.update>[0])
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: '/dashboard',
    component: () => <h1>Dashboard destination</h1>,
  })
  const signIn = createRoute({
    getParentRoute: () => root,
    path: '/sign-in',
    component: () => <h1>Ordinary sign-in</h1>,
  })
  const router = createRouter({
    routeTree: root.addChildren([start, dashboard, signIn]),
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return router
}

function show(router = setupRouter()) {
  return render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>
  )
}

beforeEach(() => {
  useAuthStore.getState().auth.reset('complete')
  localStorage.clear()
  sessionStorage.clear()
  statusFailure = false
  flowFailure = false
  providers = [provider]
  requests = []
  vi.spyOn(window, 'open').mockReturnValue(null)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    requests.push(`GET ${url}`)
    if (url !== '/api/status') throw new Error('Unexpected read')
    if (statusFailure) throw new Error('Fixture status unavailable')
    return {
      data: { success: true, data: { custom_oauth_providers: providers } },
    }
  })
  vi.spyOn(api, 'post').mockImplementation(async (url, data) => {
    requests.push(`POST ${url}`)
    if (url === '/api/user/auth/logout') return { data: { success: true } }
    if (url === '/api/oauth/state') {
      expect(data).toMatchObject({ provider: 'idone', intent: 'login' })
      return {
        data: flowFailure
          ? { success: false, message: 'OAuth failed' }
          : { success: true, data: { flow_token: 'fixture-state' } },
      }
    }
    throw new Error('Unexpected write')
  })
})

afterEach(() => {
  cleanup()
  queryClient?.clear()
  useAuthStore.getState().auth.reset('complete')
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

it('starts existing IDONE login once under StrictMode and does not accept a platform identity', async () => {
  show()
  await waitFor(() => expect(window.open).toHaveBeenCalledTimes(1))
  const target = new URL(vi.mocked(window.open).mock.calls[0][0] as string)
  expect(target.origin + target.pathname).toBe(provider.authorization_endpoint)
  expect(target.searchParams.get('client_id')).toBe('fixture-client')
  expect(target.searchParams.get('redirect_uri')).toBe(
    `${window.location.origin}/oauth/idone`
  )
  expect(target.searchParams.get('state')).toBe('fixture-state')
  expect(target.searchParams.get('response_type')).toBe('code')
  expect(target.searchParams.get('scope')).toBe('openid profile')
  expect(vi.mocked(window.open).mock.calls[0][1]).toBe('_self')
  expect(
    requests.filter((value) => value === 'POST /api/oauth/state')
  ).toHaveLength(1)
  expect(useAuthStore.getState().auth.user).toBeNull()
})

it('keeps a valid native session and goes to the dashboard without logout or OAuth', async () => {
  useAuthStore.getState().auth.setBundle({
    access_token: 'fixture-access',
    token_type: 'Bearer',
    access_expires_at: 9999999999,
    user: { id: 42, username: 'fixture', role: 1 },
    session: {
      sid: 'fixture-session',
      current: true,
      login_method: 'oauth:idone',
      ip: '',
      user_agent: '',
      created_at: 1,
      last_active_at: 1,
      expires_at: 9999999999,
    },
  })
  show()
  expect(
    await screen.findByRole('heading', { name: 'Dashboard destination' })
  ).toBeVisible()
  expect(requests.some((value) => value.startsWith('POST'))).toBe(false)
  expect(window.open).not.toHaveBeenCalled()
})

it.each([
  '',
  '?provider=missing',
  '?provider=idone&redirect=https://evil.example',
  '?provider=idone&provider=other',
  '?provider=https://evil.example',
])(
  'rejects missing, unknown or injected provider parameters: %s',
  async (search) => {
    show(setupRouter(`/auth/oidc/start${search}`))
    expect(await screen.findByText('OAuth failed')).toBeVisible()
    expect(requests.some((value) => value.startsWith('POST'))).toBe(false)
    expect(window.open).not.toHaveBeenCalled()
  }
)

it('does not launch from stale persisted configuration when status fails; retries only on click', async () => {
  localStorage.setItem(
    'status',
    JSON.stringify({ custom_oauth_providers: [provider] })
  )
  statusFailure = true
  show()
  expect(await screen.findByText('OAuth failed')).toBeVisible()
  expect(window.open).not.toHaveBeenCalled()
  expect(requests.filter((value) => value === 'GET /api/status')).toHaveLength(
    1
  )
  statusFailure = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(window.open).toHaveBeenCalledTimes(1))
})

it('offers manual retry after flow failure and can return to ordinary sign-in', async () => {
  flowFailure = true
  show()
  await screen.findByRole('button', { name: 'Retry' })
  expect(window.open).not.toHaveBeenCalled()
  expect(
    requests.filter((value) => value === 'POST /api/oauth/state')
  ).toHaveLength(1)
  flowFailure = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(window.open).toHaveBeenCalledTimes(1))
  await userEvent.click(
    await screen.findByRole('button', { name: 'Back to login' })
  )
  expect(
    await screen.findByRole('heading', { name: 'Ordinary sign-in' })
  ).toBeVisible()
  expect(
    requests.filter((value) => value === 'POST /api/oauth/state')
  ).toHaveLength(2)
})

it('preloading the route never starts authentication', async () => {
  const router = setupRouter('/sign-in')
  show(router)
  await screen.findByRole('heading', { name: 'Ordinary sign-in' })
  await act(async () => {
    await router.preloadRoute({
      to: '/auth/oidc/start',
      search: { provider: 'idone' },
    })
  })
  expect(requests.some((value) => value.startsWith('POST'))).toBe(false)
  expect(window.open).not.toHaveBeenCalled()
})

it.each([
  { ...provider, client_id: '' },
  { ...provider, authorization_endpoint: '' },
])(
  'does not clear the session or start OAuth for incomplete provider configuration',
  async (incomplete) => {
    providers = [incomplete]
    show()
    expect(await screen.findByText('OAuth failed')).toBeVisible()
    expect(requests.some((value) => value.startsWith('POST'))).toBe(false)
    expect(window.open).not.toHaveBeenCalled()
  }
)

it('does not start authorization if the existing logout preparation fails', async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: { success: false, message: 'OAuth failed' },
  })
  show()
  await screen.findByRole('button', { name: 'Retry' })
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(vi.mocked(api.post).mock.calls[0][0]).toBe('/api/user/auth/logout')
  expect(window.open).not.toHaveBeenCalled()
})
