import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@supabase/supabase-js';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get()
  @UseGuards(SupabaseAuthGuard)
  findAll() {
    return this.profilesService.findAll();
  }

  @Get('me')
  @UseGuards(SupabaseAuthGuard)
  findMe(@CurrentUser() user: User) {
    return this.profilesService.findOne(user.id);
  }

  @Get(':id')
  @UseGuards(SupabaseAuthGuard)
  findOne(@Param('id') id: string) {
    return this.profilesService.findOne(id);
  }
}
