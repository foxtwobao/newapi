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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import type { CompositeConfig, CompositeGroup } from '../api'
import { CompositeEditor } from '../editor'
import { compositeSchema } from '../lib/schema'
import CompositePage from '../page'

vi.mock('@tanstack/react-router', () => ({
  useBlocker: () => ({ status: 'idle' }),
  Link: (props: { children?: ReactNode; to: string }) => (
    <a href={props.to}>{props.children}</a>
  ),
}))
const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } } })
const config: CompositeConfig = { version: 'v1', groups: [], max_members: 32 }
const group: CompositeGroup = {
  name: 'PPTONE',
  ratio: 0.8,
  version: 'v1',
  definition: {
    enabled: true,
    cross_group_retry: false,
    members: ['GPT', 'IMAGE'],
  },
  models: [],
}
function mount(editing?: CompositeGroup) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const ui = (snapshot: CompositeConfig) => (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <CompositeEditor
          group={editing}
          config={snapshot}
          ordinaryGroups={['GPT', 'IMAGE']}
          onSaved={onSaved}
          onClose={onClose}
        />
      </I18nextProvider>
    </QueryClientProvider>
  )
  const view = render(ui(config))
  return {
    onSaved,
    onClose,
    client,
    rerender: (snapshot: CompositeConfig) => view.rerender(ui(snapshot)),
  }
}
beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: { version: 'v2' } },
  })
})
async function addMember(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add member group' }))
  fireEvent.click(await screen.findByRole('option', { name }))
}
describe('COMPOSITE management', () => {
  test('creates selected members with explicit zero ratio', async () => {
    const state = mount()
    fireEvent.change(screen.getByLabelText('Group name'), {
      target: { value: 'PPTONE' },
    })
    fireEvent.change(screen.getByLabelText('Composite ratio'), {
      target: { value: '0' },
    })
    await addMember('GPT')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(state.onSaved).toHaveBeenCalledWith('PPTONE'))
    expect(api.put).toHaveBeenCalledWith('/api/composite/PPTONE', {
      expected_version: 'v1',
      ratio: 0,
      definition: { enabled: true, cross_group_retry: false, members: ['GPT'] },
    })
  })
  test('keyboard reorder is reflected in the saved member order', async () => {
    const state = mount(group)
    expect(screen.getByLabelText('Group name')).toBeDisabled()
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Drag IMAGE to reorder' }),
      { key: 'ArrowUp' }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(state.onSaved).toHaveBeenCalled())
    expect(api.put).toHaveBeenCalledWith(
      '/api/composite/PPTONE',
      expect.objectContaining({
        definition: expect.objectContaining({ members: ['IMAGE', 'GPT'] }),
      })
    )
  })
  test('background refresh cannot overwrite draft version and conflict preserves input', async () => {
    vi.mocked(api.put).mockRejectedValue({
      response: { status: 409, data: { message: 'conflict' } },
    })
    const state = mount(group)
    fireEvent.change(screen.getByLabelText('Composite ratio'), {
      target: { value: '0.6' },
    })
    state.rerender({ ...config, version: 'v2' })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText(/Configuration changed\. Your draft is preserved/)
    ).toBeVisible()
    expect(screen.getByLabelText('Composite ratio')).toHaveValue(0.6)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(api.put).toHaveBeenCalledWith(
      '/api/composite/PPTONE',
      expect.objectContaining({ expected_version: 'v1' })
    )
    expect(state.onSaved).not.toHaveBeenCalled()
  })
  test('dirty draft requires confirmation before closing', async () => {
    const state = mount()
    fireEvent.change(screen.getByLabelText('Group name'), {
      target: { value: 'DRAFT' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Discard unsaved changes?')).toBeVisible()
    expect(state.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(state.onClose).toHaveBeenCalledOnce()
  })
  test('empty member list prevents saving', async () => {
    mount()
    fireEvent.change(screen.getByLabelText('Group name'), {
      target: { value: 'PPTONE' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText('Select at least one member group.')
    ).toBeVisible()
    expect(api.put).not.toHaveBeenCalled()
  })
  test.each(['auto', 'GPT', 'EXISTING', 'bad/name', ' bad', '名'.repeat(22)])(
    'rejects invalid or conflicting name %s',
    (name) => {
      expect(
        compositeSchema(i18n.t, ['GPT'], ['EXISTING'], 32).safeParse({
          name,
          ratio: 1,
          enabled: true,
          cross_group_retry: false,
          members: ['GPT'],
        }).success
      ).toBe(false)
    }
  )
  test.each([
    { members: ['auto'] },
    { members: ['EXISTING'] },
    { members: ['GPT', 'GPT'] },
    { members: [] },
  ])('rejects invalid member selection $members', ({ members }) => {
    expect(
      compositeSchema(i18n.t, ['GPT'], ['EXISTING'], 32).safeParse({
        name: 'NEW',
        ratio: 1,
        enabled: true,
        cross_group_retry: false,
        members,
      }).success
    ).toBe(false)
  })
})

test('a rejected save keeps the draft open and reports the server error', async () => {
  vi.mocked(api.put).mockResolvedValue({
    data: { success: false, message: 'group access denied' },
  })
  const state = mount(group)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('group access denied')).toBeVisible()
  expect(state.onSaved).not.toHaveBeenCalled()
})

test('saving invalidates group, pricing and settings queries', async () => {
  const state = mount(group)
  const invalidate = vi.spyOn(state.client, 'invalidateQueries')
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(state.onSaved).toHaveBeenCalled())
  for (const key of [
    'composites',
    'system-options',
    'user-groups',
    'pricing',
  ]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] })
  }
})

test('disabled composites can retain a missing member for recovery', () => {
  const schema = compositeSchema(i18n.t, ['GPT'], ['PPTONE'], 32, 'PPTONE')
  expect(
    schema.safeParse({
      name: 'PPTONE',
      ratio: 1,
      enabled: false,
      cross_group_retry: false,
      members: ['REMOVED'],
    }).success
  ).toBe(true)
})

test.each([-1, 1001, Infinity, Number.NaN])(
  'rejects invalid ratio %s',
  (ratio) => {
    expect(
      compositeSchema(i18n.t, ['GPT'], [], 32).safeParse({
        name: 'NEW',
        ratio,
        enabled: true,
        cross_group_retry: false,
        members: ['GPT'],
      }).success
    ).toBe(false)
  }
)

test('member limit rejects adding more than the configured maximum', () => {
  expect(
    compositeSchema(i18n.t, ['GPT', 'IMAGE'], [], 1).safeParse({
      name: 'NEW',
      ratio: 1,
      enabled: true,
      cross_group_retry: false,
      members: ['GPT', 'IMAGE'],
    }).success
  ).toBe(false)
})

function mountPage(groups: CompositeGroup[] = [group]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['system-options'], {
    success: true,
    data: [
      { key: 'GroupRatio', value: '{"GPT":1,"IMAGE":2,"PPTONE":0.8,"auto":1}' },
    ],
  })
  client.setQueryData(['composites'], { ...config, groups })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { ...config, groups } },
  })
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <CompositePage />
      </I18nextProvider>
    </QueryClientProvider>
  )
  return client
}

test('disabling requires confirmation and preserves members and ratio', async () => {
  mountPage()
  fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
  expect(await screen.findByText('Disable COMPOSITE group?')).toBeVisible()
  expect(api.put).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/composite/PPTONE', {
      expected_version: 'v1',
      ratio: 0.8,
      definition: {
        enabled: false,
        cross_group_retry: false,
        members: ['GPT', 'IMAGE'],
      },
    })
  )
})

test('empty configuration shows the creation guidance', async () => {
  mountPage([])
  expect(
    await screen.findByText(
      'No COMPOSITE groups yet. Create one to get started.'
    )
  ).toBeVisible()
})

test('preview displays unavailable configuration without crashing', async () => {
  mountPage([{ ...group, error: 'missing ratio' }])
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  expect(await screen.findByRole('button', { name: 'PPTONE' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'PPTONE' }))
  expect(
    screen.getAllByText('This composite group is unavailable')
  ).toHaveLength(2)
})

test('a failed background refresh preserves an open editing draft', async () => {
  const client = mountPage()
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByLabelText('Composite ratio'), {
    target: { value: '0.4' },
  })
  vi.mocked(api.get).mockRejectedValue(new Error('network unavailable'))
  await client.refetchQueries({ queryKey: ['composites'] })
  await waitFor(() =>
    expect(client.getQueryState(['composites'])?.status).toBe('error')
  )
  expect(screen.getByLabelText('Composite ratio')).toHaveValue(0.4)
})
