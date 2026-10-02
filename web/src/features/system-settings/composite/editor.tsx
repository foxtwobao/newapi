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
import { zodResolver } from '@hookform/resolvers/zod'
import { Reorder } from 'motion/react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { AutoGroupOrderItem } from '@/components/auto-group-order-item'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { handleServerError } from '@/lib/handle-server-error'
import {
  getServerErrorMessage,
  getServerErrorStatus,
} from '@/lib/server-error-message'

import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  useSaveComposite,
  type CompositeConfig,
  type CompositeGroup,
} from './api'
import { compositeSchema, type CompositeForm } from './lib/schema'

type EditorProps = {
  group?: CompositeGroup
  config: CompositeConfig
  ordinaryGroups: string[]
  onClose: () => void
  onSaved: (name: string) => void
}

export function CompositeEditor(props: EditorProps) {
  const { t } = useTranslation()
  const [discard, setDiscard] = useState(false)
  const [conflict, setConflict] = useState(false)
  // Capture the version with the draft, never replace it on background refetch.
  const [version] = useState(props.config.version)
  const save = useSaveComposite()
  const form = useForm<CompositeForm>({
    resolver: zodResolver(
      compositeSchema(
        t,
        props.ordinaryGroups,
        props.config.groups.map((g) => g.name),
        props.config.max_members,
        props.group?.name
      )
    ),
    defaultValues: {
      name: props.group?.name ?? '',
      ratio: props.group?.ratio ?? 1,
      enabled: props.group?.definition.enabled ?? true,
      cross_group_retry: props.group?.definition.cross_group_retry ?? false,
      members: props.group?.definition.members ?? [],
    },
  })
  const members = form.watch('members')
  const errors = form.formState.errors
  const setMembers = (next: string[]) =>
    form.setValue('members', next, { shouldDirty: true, shouldValidate: true })

  const close = () => {
    if (save.isPending) return
    if (form.formState.isDirty) setDiscard(true)
    else props.onClose()
  }
  const submit = async (values: CompositeForm) => {
    try {
      await save.mutateAsync({
        name: values.name,
        expected_version: version,
        ratio: values.ratio,
        definition: {
          enabled: values.enabled,
          members: values.members,
          cross_group_retry: values.cross_group_retry,
        },
      })
      props.onSaved(values.name)
    } catch (error) {
      if (getServerErrorStatus(error) === 409) {
        setConflict(true)
        form.setError('root', {
          message: t(
            'Configuration changed. Your draft is preserved. Close and reopen the editor to load the latest version.'
          ),
        })
      } else {
        handleServerError(error, t('Failed to update setting'))
        form.setError('root', {
          message: getServerErrorMessage(error, t('Failed to update setting')),
        })
      }
    }
  }

  return (
    <>
      <FormNavigationGuard when={form.formState.isDirty || save.isPending} />
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
        title={
          props.group ? t('Edit COMPOSITE group') : t('Create COMPOSITE group')
        }
        description={t(
          'Members are tried in order. Names cannot be changed after creation.'
        )}
        footer={
          <>
            <Button variant='outline' onClick={close} disabled={save.isPending}>
              {t('Cancel')}
            </Button>
            <Button
              type='submit'
              form='composite-editor'
              disabled={save.isPending || conflict}
            >
              {save.isPending ? t('Saving...') : t('Save')}
            </Button>
          </>
        }
      >
        <form
          id='composite-editor'
          onSubmit={form.handleSubmit(submit)}
          className='space-y-4'
        >
          <fieldset disabled={save.isPending} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='composite-name'>{t('Group name')}</Label>
              <Input
                id='composite-name'
                {...form.register('name')}
                disabled={Boolean(props.group)}
                aria-invalid={Boolean(errors.name)}
                aria-describedby='composite-name-error'
              />
              <p
                id='composite-name-error'
                className='text-destructive text-sm'
                role='alert'
              >
                {errors.name?.message}
              </p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='composite-ratio'>{t('Composite ratio')}</Label>
              <Input
                id='composite-ratio'
                type='number'
                min={0}
                max={1000}
                step='any'
                {...form.register('ratio', { valueAsNumber: true })}
                aria-invalid={Boolean(errors.ratio)}
                aria-describedby='composite-ratio-error'
              />
              {errors.ratio && (
                <p
                  id='composite-ratio-error'
                  className='text-destructive text-sm'
                  role='alert'
                >
                  {t('Enter a ratio between 0 and 1000. Zero means free.')}
                </p>
              )}
            </div>
            <div className='flex items-center gap-3'>
              <Switch
                id='composite-enabled'
                checked={form.watch('enabled')}
                onCheckedChange={(value) =>
                  form.setValue('enabled', value, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              />
              <Label htmlFor='composite-enabled'>{t('Enabled')}</Label>
            </div>
            {!form.watch('enabled') && (
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Disabling this composite prevents keys using it from making new requests.'
                )}
              </p>
            )}
            <div className='flex items-center gap-3'>
              <Switch
                id='composite-retry'
                checked={form.watch('cross_group_retry')}
                onCheckedChange={(value) =>
                  form.setValue('cross_group_retry', value, {
                    shouldDirty: true,
                  })
                }
              />
              <Label htmlFor='composite-retry'>{t('Cross-group retry')}</Label>
            </div>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Upstream failures may retry the next member within the request retry limit'
              )}
            </p>
            <div className='space-y-2'>
              <Label htmlFor='composite-members'>{t('Member groups')}</Label>
              <Combobox
                id='composite-members'
                aria-label={t('Add member group')}
                value={null}
                placeholder={t('Add member group')}
                disabled={members.length >= props.config.max_members}
                options={props.ordinaryGroups
                  .filter((name) => !members.includes(name))
                  .map((name) => ({ value: name, label: name }))}
                onValueChange={(name: string | null) => {
                  if (name) setMembers([...members, name])
                }}
              />
              <Reorder.Group
                axis='y'
                values={members}
                onReorder={setMembers}
                className='space-y-2'
              >
                {members.map((member, index) => (
                  <AutoGroupOrderItem
                    key={member}
                    group={member}
                    index={index}
                    count={members.length}
                    onRemove={(name) =>
                      setMembers(members.filter((value) => value !== name))
                    }
                    onMove={(from, direction) => {
                      const next = [...members]
                      const to = from + (direction === 'up' ? -1 : 1)
                      if (to < 0 || to >= next.length) return
                      ;[next[from], next[to]] = [next[to], next[from]]
                      setMembers(next)
                    }}
                  >
                    {!props.ordinaryGroups.includes(member) && (
                      <span className='text-destructive text-xs'>
                        {t('Unavailable')}
                      </span>
                    )}
                  </AutoGroupOrderItem>
                ))}
              </Reorder.Group>
              {errors.members && (
                <p role='alert' className='text-destructive text-sm'>
                  {errors.members.message}
                </p>
              )}
            </div>
          </fieldset>
          {errors.root && (
            <p role='alert' className='text-destructive text-sm'>
              {errors.root.message}
            </p>
          )}
        </form>
      </Dialog>
      <ConfirmDialog
        open={discard}
        onOpenChange={setDiscard}
        title={t('Discard unsaved changes?')}
        desc={t('You have unsaved changes. Are you sure you want to leave?')}
        confirmText={t('Discard changes')}
        destructive
        handleConfirm={props.onClose}
      />
    </>
  )
}
