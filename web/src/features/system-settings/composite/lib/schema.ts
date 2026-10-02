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
import type { TFunction } from 'i18next'
import { z } from 'zod'

export function compositeSchema(
  t: TFunction,
  ordinaryGroups: string[],
  compositeNames: string[],
  maxMembers: number,
  editingName?: string
) {
  return z
    .object({
      name: z
        .string()
        .refine(
          (name) =>
            name.length > 0 &&
            name === name.trim() &&
            new TextEncoder().encode(name).length <= 64 &&
            name !== 'auto' &&
            !/[,/\\\p{Cc}]/u.test(name),
          t(
            'Use a name of at most 64 bytes without commas, slashes or control characters.'
          )
        )
        .refine(
          (name) =>
            name === editingName ||
            (!ordinaryGroups.includes(name) && !compositeNames.includes(name)),
          t('This group name already exists.')
        ),
      ratio: z.number().finite().min(0).max(1000),
      enabled: z.boolean(),
      cross_group_retry: z.boolean(),
      members: z
        .array(z.string())
        .min(1, t('Select at least one member group.'))
        .max(maxMembers, t('Too many member groups.'))
        .refine(
          (members) => new Set(members).size === members.length,
          t('Duplicate member groups are not allowed.')
        ),
    })
    .superRefine((value, ctx) => {
      if (
        value.enabled &&
        value.members.some((member) => !ordinaryGroups.includes(member))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['members'],
          message: t(
            'Enabled composites require existing ordinary member groups.'
          ),
        })
      }
    })
}

export type CompositeForm = z.infer<ReturnType<typeof compositeSchema>>
