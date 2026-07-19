import { SetMetadata } from '@nestjs/common';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../permissions/permissions';

export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_ANY_KEY, permissions);
