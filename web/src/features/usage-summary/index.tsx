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
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatLogQuota, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useIsAdmin } from '@/hooks/use-admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  StaticDataTable,
  staticDataTableClassNames,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout/components/section-page-layout'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { getDefaultTimeRange } from '@/features/usage-logs/lib/utils'
import { getDailyUsageSummary, getUserDailyUsageSummary } from './api'
import type {
  UsageSummaryFilters,
  UsageSummaryItem,
  UsageSummaryParams,
  UsageSummaryTotals,
} from './types'

const EMPTY_TOTAL: UsageSummaryTotals = {
  request_count: 0,
  input_tokens: 0,
  cache_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  quota: 0,
}

function toTimestampSeconds(date?: Date): number | undefined {
  return date ? Math.floor(date.getTime() / 1000) : undefined
}

function getInitialFilters(): UsageSummaryFilters {
  const { start, end } = getDefaultTimeRange()
  return { startTime: start, endTime: end }
}

function buildSummaryParams(
  filters: UsageSummaryFilters,
  isAdmin: boolean
): UsageSummaryParams {
  const channel = filters.channel ? Number(filters.channel) : undefined

  return {
    start_timestamp: toTimestampSeconds(filters.startTime),
    end_timestamp: toTimestampSeconds(filters.endTime),
    model_name: filters.model,
    token_name: filters.token,
    group: filters.group,
    ...(isAdmin
      ? {
          username: filters.username,
          channel: Number.isFinite(channel) ? channel : undefined,
        }
      : {}),
  }
}

function SummaryMetric(props: {
  label: string
  value: string | number
  className?: string
}) {
  return (
    <div className='border-border/60 bg-muted/20 flex min-h-14 min-w-0 flex-col justify-center rounded-md border px-3 py-2'>
      <span className='text-muted-foreground text-xs'>{props.label}</span>
      <span
        className={cn(
          'text-foreground/90 truncate font-mono text-sm font-semibold tabular-nums',
          props.className
        )}
      >
        {props.value}
      </span>
    </div>
  )
}

function formatVisible(
  visible: boolean,
  value: number,
  formatter: (value: number) => string
) {
  return visible ? formatter(value) : '••••'
}

export function UsageSummary() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const [filters, setFilters] = useState<UsageSummaryFilters>(() =>
    getInitialFilters()
  )
  const [appliedFilters, setAppliedFilters] = useState<UsageSummaryFilters>(
    () => getInitialFilters()
  )
  const [sensitiveVisible, setSensitiveVisible] = useState(true)

  const queryParams = useMemo(
    () => buildSummaryParams(appliedFilters, isAdmin),
    [appliedFilters, isAdmin]
  )

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['usage-summary', isAdmin, queryParams],
    queryFn: async () => {
      const result = isAdmin
        ? await getDailyUsageSummary(queryParams)
        : await getUserDailyUsageSummary(queryParams)
      if (!result.success) {
        toast.error(result.message || t('Failed to load usage summary'))
        return { total: EMPTY_TOTAL, items: [] }
      }
      return result.data || { total: EMPTY_TOTAL, items: [] }
    },
    placeholderData: (previousData) => previousData,
  })

  const columns = useMemo<StaticDataTableColumn<UsageSummaryItem>[]>(
    () => [
      {
        id: 'name',
        header: isAdmin ? t('Account') : t('API Key'),
        className: staticDataTableClassNames.compactHeaderCell,
        cellClassName: staticDataTableClassNames.compactCell,
        cell: (row) => {
          const label = isAdmin
            ? row.username || `#${row.user_id || 0}`
            : row.token_name || `#${row.token_id || 0}`
          return (
            <span className='text-foreground/90 font-medium'>{label}</span>
          )
        },
      },
      {
        id: 'request_count',
        header: t('Requests'),
        className: staticDataTableClassNames.compactHeaderCellRight,
        cellClassName: staticDataTableClassNames.compactNumericCell,
        cell: (row) =>
          sensitiveVisible ? row.request_count.toLocaleString() : '••••',
      },
      {
        id: 'input_tokens',
        header: t('Input Tokens'),
        className: staticDataTableClassNames.compactHeaderCellRight,
        cellClassName: staticDataTableClassNames.compactMutedNumericCell,
        cell: (row) =>
          formatVisible(sensitiveVisible, row.input_tokens, formatTokens),
      },
      {
        id: 'cache_tokens',
        header: t('Cache'),
        className: staticDataTableClassNames.compactHeaderCellRight,
        cellClassName: staticDataTableClassNames.compactMutedNumericCell,
        cell: (row) =>
          formatVisible(sensitiveVisible, row.cache_tokens, formatTokens),
      },
      {
        id: 'output_tokens',
        header: t('Output Tokens'),
        className: staticDataTableClassNames.compactHeaderCellRight,
        cellClassName: staticDataTableClassNames.compactMutedNumericCell,
        cell: (row) =>
          formatVisible(sensitiveVisible, row.output_tokens, formatTokens),
      },
      {
        id: 'quota',
        header: t('Cost'),
        className: staticDataTableClassNames.compactHeaderCellRight,
        cellClassName: staticDataTableClassNames.compactNumericCell,
        cell: (row) =>
          formatVisible(sensitiveVisible, row.quota, formatLogQuota),
      },
    ],
    [isAdmin, sensitiveVisible, t]
  )

  const summary = data ?? { total: EMPTY_TOTAL, items: [] }
  const loading = isLoading || (isFetching && !data)

  const updateFilter = (
    field: keyof UsageSummaryFilters,
    value: Date | string | undefined
  ) => setFilters((current) => ({ ...current, [field]: value }))

  const handleSearch = () => setAppliedFilters(filters)
  const handleReset = () => {
    const nextFilters = getInitialFilters()
    setFilters(nextFilters)
    setAppliedFilters(nextFilters)
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Usage Summary')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost'
                size='icon'
                onClick={() => setSensitiveVisible(!sensitiveVisible)}
                aria-label={sensitiveVisible ? t('Hide') : t('Show')}
                className='text-muted-foreground hover:text-foreground'
              />
            }
          >
            {sensitiveVisible ? <Eye /> : <EyeOff />}
          </TooltipTrigger>
          <TooltipContent>
            {sensitiveVisible ? t('Hide') : t('Show')}
          </TooltipContent>
        </Tooltip>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-3'>
          <div className='bg-card/50 rounded-lg border p-2.5 sm:p-3'>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]'>
              <div className='min-w-0 sm:col-span-2'>
                <CompactDateTimeRangePicker
                  start={filters.startTime}
                  end={filters.endTime}
                  onChange={({ start, end }) => {
                    updateFilter('startTime', start)
                    updateFilter('endTime', end)
                  }}
                />
              </div>
              <Input
                placeholder={t('Model Name')}
                value={filters.model || ''}
                onChange={(e) => updateFilter('model', e.target.value)}
              />
              <Input
                placeholder={t('API Key')}
                value={filters.token || ''}
                onChange={(e) => updateFilter('token', e.target.value)}
              />
              <Input
                placeholder={t('Group')}
                value={filters.group || ''}
                onChange={(e) => updateFilter('group', e.target.value)}
              />
              {isAdmin && (
                <>
                  <Input
                    placeholder={t('Username')}
                    value={filters.username || ''}
                    onChange={(e) => updateFilter('username', e.target.value)}
                  />
                  <Input
                    placeholder={t('Channel')}
                    inputMode='numeric'
                    value={filters.channel || ''}
                    onChange={(e) => updateFilter('channel', e.target.value)}
                  />
                </>
              )}
            </div>
            <div className='mt-2 flex justify-end gap-2'>
              <Button type='button' variant='outline' onClick={handleReset}>
                {t('Reset')}
              </Button>
              <Button
                type='button'
                onClick={handleSearch}
                disabled={isFetching}
              >
                {isFetching && <Loader2 className='animate-spin' />}
                {t('Search')}
              </Button>
            </div>
          </div>

          <div className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
            <SummaryMetric
              label={t('Requests')}
              value={
                sensitiveVisible
                  ? summary.total.request_count.toLocaleString()
                  : '••••'
              }
            />
            <SummaryMetric
              label={t('Tokens')}
              value={formatVisible(
                sensitiveVisible,
                summary.total.total_tokens,
                formatTokens
              )}
            />
            <SummaryMetric
              label={t('Cost')}
              value={formatVisible(
                sensitiveVisible,
                summary.total.quota,
                formatLogQuota
              )}
            />
          </div>

          <div className='border-border/70 bg-card/50 rounded-lg border p-3'>
            {loading ? (
              <Skeleton className='h-52 w-full' />
            ) : (
              <StaticDataTable
                columns={columns}
                data={summary.items}
                className='overflow-x-auto'
                tableClassName='min-w-[720px] text-[13px]'
                headerRowClassName={staticDataTableClassNames.mutedHeaderRow}
                emptyContent={
                  <span className='text-muted-foreground text-sm'>
                    {t('No usage summary available for the selected range.')}
                  </span>
                }
                getRowKey={(row, index) =>
                  isAdmin
                    ? `user-${row.user_id || index}`
                    : `token-${row.token_id || index}`
                }
              />
            )}
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
