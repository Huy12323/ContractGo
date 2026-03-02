import { createClient } from '@supabase/supabase-js'
import type { Database } from '@worldcraft/shared/types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Run `supabase start` and copy keys from the output to your .env file.'
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
