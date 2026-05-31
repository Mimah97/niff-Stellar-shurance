import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';

type StaffRole = 'admin' | 'support_readonly';

export type AuthIdentity =
  | { kind: 'wallet'; walletAddress: string }
  | { kind: 'staff'; staffId: string; email: string; role: StaffRole; scopes: string[] };

type RequestWithIdentity = Request & {
  authIdentity?: AuthIdentity | null;
};

@Injectable()
export class AuthIdentityService {
  constructor(private readonly config: ConfigService) {}

  async resolveRequestIdentity(req: Request): Promise<AuthIdentity | null> {
    const request = req as RequestWithIdentity;
    if (request.authIdentity !== undefined) {
      return request.authIdentity;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      request.authIdentity = null;
      return null;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      request.authIdentity = null;
      return null;
    }

    try {
      const payload = jwt.verify(token, this.config.get<string>('JWT_SECRET') ?? '') as Record<
        string,
        unknown
      >;
      const identity = this.toIdentity(payload);
      request.authIdentity = identity;
      return identity;
    } catch {
      request.authIdentity = null;
      return null;
    }
  }

  private toIdentity(payload: Record<string, unknown>): AuthIdentity | null {
    if (typeof payload.walletAddress === 'string' && payload.walletAddress.length > 0) {
      return { kind: 'wallet', walletAddress: payload.walletAddress };
    }

    if (
      typeof payload.sub === 'string' &&
      typeof payload.email === 'string' &&
      (payload.role === 'admin' || payload.role === 'support_readonly')
    ) {
      const rawScopes = Array.isArray(payload.scopes)
        ? payload.scopes
        : typeof payload.scope === 'string'
          ? payload.scope.split(' ')
          : [];
      return {
        kind: 'staff',
        staffId: payload.sub,
        email: payload.email,
        role: payload.role,
        scopes: rawScopes.filter((scope): scope is string => typeof scope === 'string'),
      };
    }

    return null;
  }
}
