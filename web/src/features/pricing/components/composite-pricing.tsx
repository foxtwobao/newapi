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
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { toIntlLocale } from '@/i18n/languages'

import type { PricingModel } from '../types'
import { ModelPriceCell } from './model-price-cell'

export type CompositePricePath = {
  member: string
  composite_ratio: number
  member_ratio: number
  final_ratio: number
}

export type CompositePriceGroup = {
  name: string
  definition: {
    enabled: boolean
    cross_group_retry: boolean
    members: string[]
  }
  error?: string
  models: {
    model_name: string
    paths: CompositePricePath[]
    pricing?: PricingModel
  }[]
}

export function CompositePricing(props: { groups: CompositePriceGroup[] }) {
  const { t, i18n } = useTranslation()
  if (props.groups.length === 0) return null

  // Ratios can be smaller than 0.01; the ordinary two-decimal number formatter
  // would incorrectly display these paid paths as free.
  const number = new Intl.NumberFormat(
    toIntlLocale(i18n.resolvedLanguage || i18n.language),
    { maximumSignificantDigits: 15 }
  )

  return (
    <section className='mb-6 min-w-0' aria-label={t('Composite group pricing')}>
      <h2 className='text-lg font-semibold'>{t('Composite group pricing')}</h2>
      <p className='text-muted-foreground mt-1 text-sm'>
        {t(
          'Routes are tried in member order. The final multiplier is the composite ratio times the member ratio.'
        )}
      </p>
      <Accordion multiple>
        {props.groups.map((group) => (
          <AccordionItem key={group.name} value={group.name}>
            <AccordionTrigger>{group.name}</AccordionTrigger>
            <AccordionContent>
              {group.error ? (
                <p role='status'>{t('This composite group is unavailable')}</p>
              ) : (
                <>
                  <p className='text-muted-foreground mb-3 text-sm'>
                    {group.definition.cross_group_retry
                      ? t(
                          'Upstream failures may retry the next member within the request retry limit'
                        )
                      : t('Upstream failures stay within the selected member')}
                  </p>
                  <StaticDataTable
                    tableProps={{ 'aria-label': group.name }}
                    data={group.models.flatMap((model) =>
                      model.paths.map((path) => ({ model, path }))
                    )}
                    getRowKey={(row) =>
                      `${row.model.model_name}:${row.path.member}`
                    }
                    emptyContent={t('No available models')}
                    columns={[
                      {
                        id: 'model',
                        header: t('Model'),
                        cell: (row) => row.model.model_name,
                      },
                      {
                        id: 'member',
                        header: t('Routing member'),
                        cell: (row) => row.path.member,
                      },
                      {
                        id: 'ratio',
                        header: t('Final multiplier'),
                        cell: (row) =>
                          `${number.format(row.path.composite_ratio)} × ${number.format(row.path.member_ratio)} = ${number.format(row.path.final_ratio)}`,
                      },
                      {
                        id: 'price',
                        header: t('Price'),
                        cell: (row) =>
                          row.model.pricing ? (
                            <ModelPriceCell
                              model={{
                                ...row.model.pricing,
                                id: 0,
                                enable_groups: [row.path.member],
                                group_ratio: {
                                  [row.path.member]: row.path.final_ratio,
                                },
                              }}
                              options={{
                                selectedGroup: row.path.member,
                                showRechargePrice: false,
                              }}
                            />
                          ) : (
                            t('Not configured')
                          ),
                      },
                    ]}
                  />
                </>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
