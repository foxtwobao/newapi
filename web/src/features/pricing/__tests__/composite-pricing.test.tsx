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
import { act, render, screen, within } from '@testing-library/react'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { expect, it } from 'vitest'

import { CompositePricing } from '../components/composite-pricing'

const group = {
  name: 'AGENTONE–Creative',
  ratio: 0.8,
  definition: {
    enabled: true,
    cross_group_retry: false,
    members: ['IMAGE'],
  },
  models: [
    {
      model_name: 'private-model-price',
      paths: [
        {
          member: 'IMAGE',
          composite_ratio: 0.8,
          member_ratio: 0.4,
          final_ratio: 0.32,
        },
      ],
    },
  ],
}

it('explains ONE app multipliers and direct API billing with a navigation link and no model price details', () => {
  render(
    <CompositePricing
      groups={[group, { ...group, name: 'FREE', ratio: 0, models: [] }]}
    />
  )

  const section = screen.getByRole('region', {
    name: 'ONE app composite multipliers',
  })
  expect(within(section).getByText(group.name)).toBeVisible()
  expect(within(section).getByText('×0.8')).toBeVisible()
  expect(within(section).getByText('×0')).toBeVisible()
  expect(section).toHaveTextContent(
    'When using models through ONE apps, final billing multiplier = app composite multiplier × the multiplier of the group used in the model list below.'
  )
  expect(
    within(section).getByText(
      'Direct TokenONE API calls are billed using only the model group multiplier, without the app composite multiplier.'
    )
  ).toBeVisible()
  expect(
    within(section).getByRole('link', { name: 'ONE apps' })
  ).toHaveAttribute('href', 'https://home.agentone.work')
  expect(within(section).queryByRole('button')).not.toBeInTheDocument()
  expect(within(section).queryByRole('table')).not.toBeInTheDocument()
  expect(
    within(section).queryByText('private-model-price')
  ).not.toBeInTheDocument()
  expect(within(section).queryByText('0.32')).not.toBeInTheDocument()
})

it('shows unavailable and unconfigured groups without inventing a multiplier from model paths', () => {
  render(
    <CompositePricing
      groups={[
        { ...group, name: 'DISABLED', error: 'disabled' },
        { ...group, name: 'MISSING', ratio: null },
      ]}
    />
  )

  expect(screen.getByRole('status')).toHaveTextContent(
    'This composite group is unavailable'
  )
  expect(screen.getByText('Not configured')).toBeVisible()
  expect(screen.queryByText('×0.8')).not.toBeInTheDocument()
})

it('hides the summary when there are no composite groups', () => {
  render(<CompositePricing groups={[]} />)
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
})

it('preserves small multipliers across interface languages and updates formatting after a language switch', async () => {
  const i18n = i18next.createInstance()
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: Object.fromEntries(
      ['en', 'zhCN', 'zhTW', 'fr', 'ru', 'ja', 'vi', 'invalid_locale'].map(
        (language) => [language, { translation: { Multiplier: 'Multiplier' } }]
      )
    ),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <CompositePricing groups={[{ ...group, ratio: 0.00012345 }]} />
    </I18nextProvider>
  )

  for (const [language, multiplier] of [
    ['en', '×0.00012345'],
    ['zhCN', '×0.00012345'],
    ['zhTW', '×0.00012345'],
    ['fr', '×0,00012345'],
    ['ru', '×0,00012345'],
    ['ja', '×0.00012345'],
    ['vi', '×0,00012345'],
    ['invalid_locale', '×0.00012345'],
  ]) {
    await act(() => i18n.changeLanguage(language))
    expect(screen.getByText(multiplier)).toBeVisible()
  }
})
