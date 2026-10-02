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

export interface UsageSummaryFilters {
  startTime?: Date
  endTime?: Date
  model?: string
  token?: string
  group?: string
  username?: string
  channel?: string
}

export interface UsageSummaryParams {
  username?: string
  token_name?: string
  model_name?: string
  start_timestamp?: number
  end_timestamp?: number
  channel?: number
  group?: string
}

export interface UsageSummaryTotals {
  request_count: number
  input_tokens: number
  cache_tokens: number
  output_tokens: number
  total_tokens: number
  quota: number
}

export interface UsageSummaryItem extends UsageSummaryTotals {
  user_id?: number
  username?: string
  token_id?: number
  token_name?: string
}

export interface UsageSummaryData {
  total: UsageSummaryTotals
  items: UsageSummaryItem[]
}

export interface GetUsageSummaryResponse {
  success: boolean
  message?: string
  data?: UsageSummaryData
}
