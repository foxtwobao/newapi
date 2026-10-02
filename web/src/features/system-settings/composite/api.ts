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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { CompositePriceGroup } from '@/features/pricing/components/composite-pricing'
import { api } from '@/lib/api'
import {
  getServerErrorStatus,
  requireServerSuccess,
} from '@/lib/server-error-message'

export type CompositeGroup = CompositePriceGroup & {
  ratio: number | null
  version: string
}
export type CompositeConfig = {
  version: string
  groups: CompositeGroup[]
  max_members: number
}
export type CompositeChange = {
  name: string
  expected_version: string
  definition: CompositeGroup['definition']
  ratio: number
}

export function useComposites() {
  return useQuery({
    queryKey: ['composites'],
    queryFn: async () => {
      const response = await api.get<{
        success: boolean
        message: string
        data: CompositeConfig
      }>('/api/composite')
      return requireServerSuccess(response.data).data
    },
  })
}

export function useSaveComposite() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (change: CompositeChange) => {
      const { name, ...body } = change
      const response = await api.put(
        `/api/composite/${encodeURIComponent(name)}`,
        body
      )
      return requireServerSuccess(response.data)
    },
    // Callers display errors inline or through the shared error handler.
    meta: { errorToast: false },
    onError: (error) => {
      if (getServerErrorStatus(error) === 409) {
        void client.invalidateQueries({ queryKey: ['composites'] })
        void client.invalidateQueries({ queryKey: ['system-options'] })
      }
    },
    onSuccess: () => {
      for (const key of [
        'composites',
        'system-options',
        'user-groups',
        'pricing',
      ]) {
        void client.invalidateQueries({ queryKey: [key] })
      }
    },
  })
}
