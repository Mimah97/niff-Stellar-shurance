import { Injectable, NestMiddleware, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class MetricsAuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(MetricsAuthMiddleware.name);
  private readonly authToken: string | undefined;
  private readonly allowedIps: string[];

  constructor(private readonly configService: ConfigService) {
    this.authToken = this.configService.get<string>('METRICS_AUTH_TOKEN');
    const ipsStr = this.configService.get<string>('METRICS_ALLOWED_IPS');
    this.allowedIps = ipsStr ? ipsStr.split(',').map(ip => ip.trim()) : [];

    if (!this.authToken && this.allowedIps.length === 0) {
      this.logger.warn(
        'METRICS_AUTH_TOKEN and METRICS_ALLOWED_IPS are both unset. ' +
        'The /metrics endpoint is unprotected and accessible to anyone who can reach it.'
      );
    }
  }

  use(req: Request, res: Response, next: NextFunction): void {
    // Check bearer token if configured
    if (this.authToken) {
      const authHeader = req.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

      if (!token || token !== this.authToken) {
        throw new UnauthorizedException('Invalid or missing metrics token');
      }
    }

    // Check IP allowlist if configured
    if (this.allowedIps.length > 0) {
      const clientIp = this.getClientIp(req);
      if (!this.allowedIps.includes(clientIp)) {
        this.logger.warn(`Metrics access denied for IP: ${clientIp}`);
        throw new ForbiddenException('IP address not allowed');
      }
    }

    next();
  }

  private getClientIp(req: Request): string {
    // Check X-Forwarded-For header (proxy) first
    const forwarded = req.get('X-Forwarded-For');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }

    // Fall back to socket remote address
    return req.ip || req.socket.remoteAddress || 'unknown';
  }
}
