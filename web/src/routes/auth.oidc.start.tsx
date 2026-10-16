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
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { AuthLayout } from '@/features/auth/auth-layout'
import { useOAuthLogin } from '@/features/auth/hooks/use-oauth-login'
import type { SystemStatus } from '@/features/auth/types'
import { resolveAuthentication } from '@/lib/auth-session'
import { AuthOperationError } from '@/lib/secure-verification'
import { statusQueryOptions } from '@/lib/status-query'

const searchSchema = z
  .object({
    provider: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/),
  })
  .strict()

function StartError() {
  const { t } = useTranslation()
  const router = useRouter()
  return (
    <AuthLayout>
      <ErrorState
        title={t('OAuth failed')}
        onRetry={() => void router.invalidate()}
        action={
          <Button variant='link' render={<Link to='/sign-in' />}>
            {t('Back to login')}
          </Button>
        }
      />
    </AuthLayout>
  )
}

function StartLogin() {
  const { provider } = Route.useLoaderData()
  const { t } = useTranslation()
  const { handleCustomOAuthLogin } = useOAuthLogin(null, '/dashboard')
  const started = useRef(false)
  const [settled, setSettled] = useState(false)

  // Starting authentication belongs to the mounted page, never a route preload.
  // The ref also prevents StrictMode and hook rerenders from issuing two flows.
  useEffect(() => {
    if (started.current) return
    started.current = true
    void handleCustomOAuthLogin(provider).finally(() => setSettled(true))
  }, [handleCustomOAuthLogin, provider])

  return (
    <AuthLayout>
      <LoadingState message={t('Sign in')} />
      {settled && (
        <div className='flex justify-center gap-2'>
          <Button
            onClick={() => {
              setSettled(false)
              void handleCustomOAuthLogin(provider).finally(() =>
                setSettled(true)
              )
            }}
          >
            {t('Retry')}
          </Button>
          <Button variant='link' render={<Link to='/sign-in' />}>
            {t('Back to login')}
          </Button>
        </div>
      )}
    </AuthLayout>
  )
}

export const Route = createFileRoute('/auth/oidc/start')({
  validateSearch: searchSchema,
  beforeLoad: async () => {
    const auth = await resolveAuthentication()
    if (auth.kind === 'authenticated') {
      throw redirect({ to: '/dashboard', replace: true })
    }
    if (auth.kind !== 'anonymous') throw new AuthOperationError('OAuth failed')
  },
  loaderDeps: ({ search }) => ({ provider: search.provider }),
  loader: async ({ context, deps }) => {
    // Do not automatically launch using the persisted status placeholder.
    const status = (await context.queryClient.fetchQuery({
      ...statusQueryOptions,
      staleTime: 0,
      retry: false,
    })) as SystemStatus | null
    const provider = status?.custom_oauth_providers?.find(
      (value) => value.slug === deps.provider
    )
    if (!provider?.client_id || !provider.authorization_endpoint) {
      throw new AuthOperationError('OAuth failed')
    }
    return { provider }
  },
  remountDeps: ({ search }) => search,
  component: StartLogin,
  errorComponent: StartError,
})
