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
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StaticDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { CompositePricing } from '@/features/pricing/components/composite-pricing'
import { toIntlLocale } from '@/i18n/languages'
import { handleServerError } from '@/lib/handle-server-error'

import { SettingsPageActionsPortal } from '../components/settings-page-context'
import { useSystemOptions } from '../hooks/use-system-options'
import { useComposites, useSaveComposite, type CompositeGroup } from './api'
import { CompositeEditor } from './editor'

export default function CompositePage() {
  const { t, i18n } = useTranslation()
  const config = useComposites()
  const options = useSystemOptions()
  const save = useSaveComposite()
  const [editor, setEditor] = useState<{ group?: CompositeGroup } | null>(null)
  const [toggle, setToggle] = useState<CompositeGroup | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  if (config.isPending || options.isPending) return <LoadingState />
  if (!config.data || !options.data) {
    return (
      <ErrorState
        onRetry={() => {
          void config.refetch()
          void options.refetch()
        }}
      />
    )
  }

  let ordinaryGroups: string[]
  try {
    const ratios: unknown = JSON.parse(
      options.data.data.find((option) => option.key === 'GroupRatio')?.value ??
        '{}'
    )
    if (!ratios || typeof ratios !== 'object' || Array.isArray(ratios)) {
      throw new Error('Invalid group ratios')
    }
    ordinaryGroups = Object.entries(ratios)
      .filter(
        ([name, ratio]) =>
          name !== 'auto' &&
          !config.data.groups.some((group) => group.name === name) &&
          typeof ratio === 'number' &&
          Number.isFinite(ratio)
      )
      .map(([name]) => name)
      .sort()
  } catch {
    return (
      <ErrorState
        title={t('Group configuration is unavailable')}
        onRetry={() => {
          void options.refetch()
        }}
      />
    )
  }
  // Preserve small paid ratios, matching the existing composite price display.
  const number = new Intl.NumberFormat(
    toIntlLocale(i18n.resolvedLanguage || i18n.language),
    { maximumSignificantDigits: 15 }
  )
  const previewGroup = config.data.groups.find(
    (group) => group.name === preview
  )

  const changeEnabled = async () => {
    if (!toggle || toggle.ratio === null) return
    try {
      await save.mutateAsync({
        name: toggle.name,
        expected_version: toggle.version,
        ratio: toggle.ratio,
        definition: {
          ...toggle.definition,
          enabled: !toggle.definition.enabled,
        },
      })
      setToggle(null)
      toast.success(t('Setting updated successfully'))
    } catch (error) {
      handleServerError(error, t('Failed to update setting'))
      setToggle(null)
      void config.refetch()
    }
  }

  return (
    <div className='space-y-4'>
      <SettingsPageActionsPortal>
        <Button size='sm' onClick={() => setEditor({})}>
          {t('Create COMPOSITE group')}
        </Button>
      </SettingsPageActionsPortal>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Create the composite here, then configure its visibility in Group Pricing before selecting it for a key.'
        )}
      </p>
      <div className='flex flex-wrap items-center gap-3'>
        <Button
          variant='outline'
          size='sm'
          render={
            <Link
              to='/system-settings/billing/$section'
              params={{ section: 'group-pricing' }}
            />
          }
        >
          {t('Configure group visibility')}
        </Button>
        <Button variant='outline' size='sm' render={<Link to='/keys' />}>
          {t('Create API key')}
        </Button>
        <Button
          variant='ghost'
          size='sm'
          disabled={config.isFetching || options.isFetching}
          onClick={() => {
            void config.refetch()
            void options.refetch()
          }}
        >
          {t('Refresh')}
        </Button>
      </div>
      {saved && (
        <p role='status' className='text-sm'>
          {t(
            'Composite {{name}} saved. Configure group visibility if users cannot select it.',
            { name: saved }
          )}
        </p>
      )}
      <StaticDataTable
        data={config.data.groups}
        getRowKey={(group) => group.name}
        emptyContent={t('No COMPOSITE groups yet. Create one to get started.')}
        columns={[
          {
            id: 'name',
            header: t('Group name'),
            cell: (group) => (
              <span className='font-medium break-all'>{group.name}</span>
            ),
          },
          {
            id: 'status',
            header: t('Status'),
            cell: (group) => (
              <div>
                {group.definition.enabled ? t('Enabled') : t('Disabled')}
                {group.error && (
                  <p className='text-destructive text-xs'>
                    {t('This composite group is unavailable')}
                  </p>
                )}
              </div>
            ),
          },
          {
            id: 'members',
            header: t('Member groups'),
            cell: (group) => (
              <span className='break-all'>
                {group.definition.members.join(' → ')}
              </span>
            ),
          },
          {
            id: 'ratio',
            header: t('Composite ratio'),
            cell: (group) =>
              group.ratio === null
                ? t('Unavailable')
                : number.format(group.ratio),
          },
          {
            id: 'retry',
            header: t('Cross-group retry'),
            cell: (group) =>
              group.definition.cross_group_retry ? t('Enabled') : t('Disabled'),
          },
          {
            id: 'actions',
            header: t('Actions'),
            cell: (group) => (
              <div className='flex flex-wrap gap-1'>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => setEditor({ group })}
                >
                  {t('Edit')}
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() =>
                    setPreview(preview === group.name ? null : group.name)
                  }
                >
                  {t('Preview')}
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={group.ratio === null || save.isPending}
                  onClick={() => setToggle(group)}
                >
                  {group.definition.enabled ? t('Disable') : t('Enable')}
                </Button>
              </div>
            ),
          },
        ]}
      />
      {previewGroup && <CompositePricing groups={[previewGroup]} />}
      {editor && (
        <CompositeEditor
          group={editor.group}
          config={config.data}
          ordinaryGroups={ordinaryGroups}
          onClose={() => setEditor(null)}
          onSaved={(name) => {
            setEditor(null)
            setSaved(name)
            toast.success(t('Setting updated successfully'))
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(toggle)}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setToggle(null)
        }}
        title={
          toggle?.definition.enabled
            ? t('Disable COMPOSITE group?')
            : t('Enable COMPOSITE group?')
        }
        desc={t(
          'Disabling this composite prevents keys using it from making new requests.'
        )}
        destructive={toggle?.definition.enabled}
        isLoading={save.isPending}
        handleConfirm={() => {
          void changeEnabled()
        }}
      />
    </div>
  )
}
