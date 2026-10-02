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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import { apiKeySchema, type ApiKey } from '../../types'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { api } = await import('@/lib/api')
const { ApiKeysProvider } = await import('../api-keys-provider')
const { ApiKeysMutateDrawer } = await import('../api-keys-mutate-drawer')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

type ApiMethod = (url: string, data?: unknown) => Promise<{ data: unknown }>
type MockableApi = {
  get: ApiMethod
  post: ApiMethod
  put: ApiMethod
}
type RenderedDrawer = {
  queryClient: InstanceType<typeof QueryClient>
}

const apiClient = api as unknown as MockableApi
const originalGet = apiClient.get
const originalPost = apiClient.post
const originalPut = apiClient.put
let renderedDrawer: RenderedDrawer | null = null

function installApiFixtures(
  createdPayloads: Array<Record<string, unknown>>,
  currentRow?: ApiKey
) {
  apiClient.get = async (url) => {
    switch (url) {
      case '/api/status':
        return { data: { data: { default_use_auto_group: true } } }
      case '/api/user/models':
        return { data: { success: true, data: [] } }
      case '/api/user/self/groups':
        return {
          data: {
            success: true,
            data: {
              auto: { desc: 'Automatic routing', ratio: 'auto' },
              default: { desc: 'Standard access', ratio: 1 },
              vip: { desc: 'Priority access', ratio: 2 },
              PPTONE: {
                desc: 'Composite access',
                ratio: 'COMPOSITE',
                type: 'composite',
              },
            },
          },
        }
      case '/api/token/auto-groups':
        return {
          data: {
            success: true,
            data: { groups: ['vip', 'default'], max_count: 3 },
          },
        }
      default:
        if (currentRow && url === `/api/token/${currentRow.id}`) {
          return { data: { success: true, data: currentRow } }
        }
        throw new Error(`Unexpected GET ${url}`)
    }
  }
  apiClient.post = async (url, data) => {
    expect(url).toBe('/api/token/')
    expect(data && typeof data === 'object').toBeTruthy()
    createdPayloads.push(data as Record<string, unknown>)
    return { data: { success: true, data: {} } }
  }
  apiClient.put = apiClient.post
}

async function renderDrawer(
  currentRow?: ApiKey,
  cacheGroups = true
): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const freshAt = Date.now() + 60_000
  queryClient.setQueryData(
    ['status'],
    { default_use_auto_group: true },
    { updatedAt: freshAt }
  )
  queryClient.setQueryData(
    ['user-models'],
    { success: true, data: [] },
    { updatedAt: freshAt }
  )
  if (cacheGroups) {
    queryClient.setQueryData(
      ['user-groups'],
      {
        success: true,
        data: {
          auto: { desc: 'Automatic routing', ratio: 'auto' },
          default: { desc: 'Standard access', ratio: 1 },
          vip: { desc: 'Priority access', ratio: 2 },
          PPTONE: {
            desc: 'Composite access',
            ratio: 'COMPOSITE',
            type: 'composite',
          },
        },
      },
      { updatedAt: freshAt }
    )
  }
  queryClient.setQueryData(
    ['token-auto-groups'],
    {
      success: true,
      data: { groups: ['vip', 'default'], max_count: 3 },
    },
    { updatedAt: freshAt }
  )
  renderedDrawer = { queryClient }

  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <ApiKeysProvider>
          <ApiKeysMutateDrawer
            open
            currentRow={currentRow}
            onOpenChange={() => undefined}
          />
        </ApiKeysProvider>
      </I18nextProvider>
    </QueryClientProvider>
  )
  await waitFor(
    () => {
      const saveButton = findButton('Save changes', false)
      expect(saveButton).toBeEnabled()
    },
    { timeout: 1500 }
  )
}

function findButton(text: string, required: true): HTMLButtonElement
function findButton(text: string, required: false): HTMLButtonElement | null
function findButton(text: string, required = true): HTMLButtonElement | null {
  const button = screen
    .queryAllByRole<HTMLButtonElement>('button')
    .find((candidate) => candidate.textContent?.includes(text))
  if (required && !button) {
    throw new Error(`Expected button containing "${text}"`)
  }
  return button ?? null
}

function getControlByLabel(labelText: 'Name' | 'Quantity'): HTMLInputElement
function getControlByLabel(labelText: 'Group'): HTMLButtonElement
function getControlByLabel(labelText: 'Auto group order'): HTMLElement
function getControlByLabel(labelText: string): HTMLElement {
  const label = [...document.querySelectorAll<HTMLLabelElement>('label')].find(
    (candidate) => candidate.textContent?.trim() === labelText
  )
  if (!label) {
    throw new Error(`Expected label "${labelText}"`)
  }

  const control =
    label.control ??
    label
      .closest('[data-slot="form-item"]')
      ?.querySelector<HTMLElement>(
        '[data-slot="form-control"], input, textarea, button[role="combobox"], [role="group"]'
      )
  if (!control) {
    throw new Error(`Expected control for label "${labelText}"`)
  }
  return control
}

function changeInput(input: HTMLInputElement, value: string): void {
  fireEvent.input(input, { target: { value } })
}

function selectComboboxOption(
  trigger: HTMLButtonElement,
  optionDescription: string
): void {
  fireEvent.click(trigger)
  const option = [
    ...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]'),
  ].find((candidate) => candidate.textContent?.includes(optionDescription))
  if (!option) {
    throw new Error(`Expected option containing "${optionDescription}"`)
  }
  fireEvent.click(option)
}

afterEach(() => {
  apiClient.get = originalGet
  apiClient.post = originalPost
  apiClient.put = originalPut
  localStorage.clear()
  if (renderedDrawer) {
    renderedDrawer.queryClient.clear()
    renderedDrawer = null
  }
})

describe('API keys mutate drawer Auto group integration', () => {
  test('hides composites from both new key groups and custom Auto members', async () => {
    const createdPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(createdPayloads)
    await renderDrawer()

    const autoOrderControl = getControlByLabel('Auto group order')
    const addGroupTrigger = autoOrderControl.querySelector<HTMLButtonElement>(
      'button[role="combobox"]'
    )
    if (!addGroupTrigger) {
      throw new Error('Expected Auto group order combobox')
    }
    fireEvent.click(addGroupTrigger)
    expect(screen.queryByText('Composite access')).not.toBeInTheDocument()
    fireEvent.click(addGroupTrigger)

    fireEvent.click(getControlByLabel('Group'))
    expect(screen.queryByText('Composite access')).not.toBeInTheDocument()
    expect(screen.queryByText('PPTONE')).not.toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: /Standard access/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: /Automatic routing/ })
    ).toBeInTheDocument()
  })

  test('inherits the root Auto order and sends an empty override for every batch-created key', async () => {
    const createdPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(createdPayloads)
    await renderDrawer()

    const groupTrigger = getControlByLabel('Group')
    expect(groupTrigger.textContent?.includes('auto')).toBe(true)
    expect(
      document.body.textContent?.includes(
        'Using the complete global Auto order (2 groups)'
      )
    ).toBe(true)
    expect(
      [
        ...document.querySelectorAll('[data-slot="global-auto-order-name"]'),
      ].map((item) => item.textContent)
    ).toEqual(['vip', 'default'])
    expect(findButton('Restore global Auto', true).disabled).toBe(true)

    changeInput(getControlByLabel('Name'), 'batch')
    changeInput(getControlByLabel('Quantity'), '2')
    fireEvent.click(findButton('Save changes', true))
    await waitFor(() => expect(createdPayloads).toHaveLength(2))

    expect(createdPayloads.length).toBe(2)
    expect(createdPayloads[0]?.name).toBe('batch')
    for (const payload of createdPayloads) {
      expect(payload.group).toBe('auto')
      expect(payload.auto_groups).toEqual([])
      expect(payload.cross_group_retry).toBe(true)
    }
  })

  test('preserves an unsaved custom order and mode after Auto to ordinary to Auto changes', async () => {
    const createdPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(createdPayloads)
    await renderDrawer()

    const autoOrderControl = getControlByLabel('Auto group order')
    const addGroupTrigger = autoOrderControl.querySelector<HTMLButtonElement>(
      'button[role="combobox"]'
    )
    if (!addGroupTrigger) {
      throw new Error('Expected Auto group order combobox')
    }
    selectComboboxOption(addGroupTrigger, 'Priority access')

    expect(
      document.querySelector('button[aria-label="Remove vip"]')
    ).toBeTruthy()
    expect(document.body.textContent?.includes('1 / 3 groups selected')).toBe(
      true
    )
    expect(findButton('Restore global Auto', true).disabled).toBe(false)

    const groupTrigger = getControlByLabel('Group')
    selectComboboxOption(groupTrigger, 'Standard access')
    expect(document.querySelector('button[aria-label="Remove vip"]')).toBe(null)
    selectComboboxOption(groupTrigger, 'Automatic routing')

    expect(
      document.querySelector('button[aria-label="Remove vip"]')
    ).toBeTruthy()
    expect(document.body.textContent?.includes('1 / 3 groups selected')).toBe(
      true
    )
    expect(findButton('Restore global Auto', true).disabled).toBe(false)

    changeInput(getControlByLabel('Name'), 'custom')
    fireEvent.click(findButton('Save changes', true))
    await waitFor(() => expect(createdPayloads).toHaveLength(1))
    expect(createdPayloads[0]?.auto_groups).toEqual(['vip'])
  })
})

const appKey = apiKeySchema.parse({
  id: 42,
  name: 'App key',
  key: 'masked-test-key',
  status: 1,
  remain_quota: 1_000_000,
  used_quota: 0,
  unlimited_quota: false,
  expired_time: 2_000_000_000,
  created_time: 0,
  accessed_time: 0,
  group: 'PPTONE',
  model_limits_enabled: true,
  model_limits: 'gpt-test',
  allow_ips: '192.0.2.1',
})

describe('API key group visibility when editing', () => {
  test('hides the composite group and preserves it when saving other key settings', async () => {
    const payloads: Array<Record<string, unknown>> = []
    installApiFixtures(payloads, appKey)
    await renderDrawer(appKey)

    expect(screen.queryByText('Group', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('PPTONE')).not.toBeInTheDocument()
    changeInput(getControlByLabel('Name'), 'Renamed app key')
    fireEvent.click(findButton('Save changes', true))
    await waitFor(() => expect(payloads).toHaveLength(1))
    expect(payloads[0]).toMatchObject({
      id: 42,
      name: 'Renamed app key',
      group: 'PPTONE',
      remain_quota: 1_000_000,
      expired_time: 2_000_000_000,
      unlimited_quota: false,
      model_limits_enabled: true,
      model_limits: 'gpt-test',
      allow_ips: '192.0.2.1',
    })
  })

  test('prevents renaming a composite key', async () => {
    const payloads: Array<Record<string, unknown>> = []
    installApiFixtures(payloads, appKey)
    await renderDrawer(appKey)

    const nameInput = getControlByLabel('Name')
    expect(nameInput).toBeDisabled()
    expect(nameInput.value).toBe('App key')
  })

  test('allows ordinary group changes while excluding composite options', async () => {
    const payloads: Array<Record<string, unknown>> = []
    const ordinaryKey = { ...appKey, group: 'default' }
    installApiFixtures(payloads, ordinaryKey)
    await renderDrawer(ordinaryKey)

    fireEvent.click(getControlByLabel('Group'))
    expect(screen.queryByText('Composite access')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Priority access'))
    fireEvent.click(findButton('Save changes', true))
    await waitFor(() => expect(payloads).toHaveLength(1))
    expect(payloads[0]?.group).toBe('vip')
  })

  test.each(['failure', 'missing group'])(
    'preserves the stored group when group metadata has %s',
    async (scenario) => {
      const payloads: Array<Record<string, unknown>> = []
      installApiFixtures(payloads, appKey)
      const get = apiClient.get
      apiClient.get = async (url) => {
        if (url !== '/api/user/self/groups') return get(url)
        if (scenario === 'failure') {
          throw new Error('Group metadata unavailable')
        }
        return {
          data: {
            success: true,
            data: { default: { desc: 'Standard access', ratio: 1 } },
          },
        }
      }
      await renderDrawer(appKey, false)

      expect(
        screen.queryByText('Group', { exact: true })
      ).not.toBeInTheDocument()
      changeInput(getControlByLabel('Name'), 'Preserved app key')
      fireEvent.click(findButton('Save changes', true))
      await waitFor(() => expect(payloads).toHaveLength(1))
      expect(payloads[0]?.group).toBe('PPTONE')
    }
  )
})

test('keeps composite quota and expiration editable without changing its group', async () => {
  const payloads: Array<Record<string, unknown>> = []
  installApiFixtures(payloads, appKey)
  await renderDrawer(appKey)

  fireEvent.change(screen.getByRole('spinbutton', { name: /Quota/ }), {
    target: { value: '3' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Never' }))
  fireEvent.click(findButton('Save changes', true))
  await waitFor(() => expect(payloads).toHaveLength(1))
  expect(payloads[0]).toMatchObject({
    group: 'PPTONE',
    remain_quota: 1_500_000,
    expired_time: -1,
  })
})

test('waits for group metadata before enabling edits and preserves the composite group after loading', async () => {
  const payloads: Array<Record<string, unknown>> = []
  installApiFixtures(payloads, appKey)
  const get = apiClient.get
  let resolveGroups!: (response: Awaited<ReturnType<ApiMethod>>) => void
  const pending = new Promise<Awaited<ReturnType<ApiMethod>>>((resolve) => {
    resolveGroups = resolve
  })
  apiClient.get = (url) =>
    url === '/api/user/self/groups' ? pending : get(url)
  const ready = renderDrawer(appKey, false)

  expect(findButton('Save changes', true)).toBeDisabled()
  expect(screen.queryByText('Group', { exact: true })).not.toBeInTheDocument()
  expect(screen.queryByText('PPTONE')).not.toBeInTheDocument()
  resolveGroups(await get('/api/user/self/groups'))
  await ready

  fireEvent.click(findButton('Save changes', true))
  await waitFor(() => expect(payloads).toHaveLength(1))
  expect(payloads[0]?.group).toBe('PPTONE')
})
