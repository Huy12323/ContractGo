import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [AuthModule, ProfilesModule, HealthModule],
})
export class AppModule {}
