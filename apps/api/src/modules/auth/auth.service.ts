import { Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@worldcraft/shared';

@Injectable()
export class AuthService {
  private supabase = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  async getUserById(userId: string) {
    const {
      data: { user },
      error,
    } = await this.supabase.auth.admin.getUserById(userId);
    if (error) throw error;
    return user;
  }
}
