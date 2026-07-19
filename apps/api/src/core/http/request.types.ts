import type { Request } from 'express';

export interface JwtTokenPayload {
  sub: string;
  email: string;
}

export interface JwtUserPayload {
  id: string;
  email: string;
}

export interface AuthCompanyRef {
  id: string;
  name: string;
}

export interface AuthRoleRef {
  id?: string;
  name: string;
  permissions?: string[];
}

export interface AuthCompanyMembership {
  company: AuthCompanyRef;
  role: AuthRoleRef;
}

export interface AuthUserRecord extends JwtUserPayload {
  name: string;
  passwordHash: string;
  companies: AuthCompanyMembership[];
}

export interface AuthenticatedUser extends JwtUserPayload {
  name: string;
  companies: AuthCompanyMembership[];
}

export interface AuthUserProfile {
  id: string;
  email: string;
  name: string;
}

export interface RequestWithAuth extends Request {
  user?: JwtUserPayload;
  companyId?: string;
  userRole?: AuthRoleRef | null;
}
