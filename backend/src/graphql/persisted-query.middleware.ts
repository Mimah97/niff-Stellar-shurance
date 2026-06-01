import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { RedisService } from '../cache/redis.service';

type PersistedQueryRequest = Request & {
  body?: {
    query?: string;
    extensions?: {
      persistedQuery?: {
        sha256Hash?: string;
        version?: number;
      };
    };
  };
};

@Injectable()
export class PersistedQueryMiddleware implements NestMiddleware {
  private readonly enabled: boolean;
  private readonly required: boolean;
  private readonly registrationEnabled: boolean;
  private readonly persistedQueriesOnly: boolean;
  private readonly allowlistHashes: Set<string>;
  private readonly allowlistBodies: Map<string, string>;
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    const isProduction = config.get<string>('NODE_ENV') === 'production';
    this.enabled = config.get<boolean>('GRAPHQL_PERSISTED_QUERIES_ENABLED', false);
    this.required = config.get<boolean>('GRAPHQL_PERSISTED_QUERIES_REQUIRED', isProduction);
    this.registrationEnabled = config.get<boolean>(
      'GRAPHQL_PERSISTED_QUERY_REGISTRATION_ENABLED',
      !isProduction,
    );
    this.persistedQueriesOnly = config.get<boolean>(
      'GRAPHQL_PERSISTED_QUERIES_ONLY',
      isProduction,
    );
    this.ttlSeconds = config.get<number>('GRAPHQL_PERSISTED_QUERY_TTL_SECONDS', 86_400);

    this.allowlistBodies = PersistedQueryMiddleware.loadAllowlistFile(config);

    const envHashes = (config.get<string>('GRAPHQL_PERSISTED_QUERY_ALLOWLIST', '') ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);

    this.allowlistHashes = new Set([...this.allowlistBodies.keys(), ...envHashes]);
  }

  async use(req: PersistedQueryRequest, res: Response, next: NextFunction): Promise<void> {
    const persistedQuery = req.body?.extensions?.persistedQuery;
    const hash = persistedQuery?.sha256Hash;
    const query = req.body?.query;

    if (!this.persistedQueriesOnly) {
      // Development mode: no hash required, no allowlist enforcement.
      if (!hash) {
        if (this.required) {
          this.writeError(res, 'Persisted query hash is required', 'PERSISTED_QUERY_REQUIRED');
          return;
        }
        return next();
      }

      if (!this.enabled) {
        this.writeError(res, 'Persisted queries are disabled', 'PERSISTED_QUERY_DISABLED');
        return;
      }

      return this.processApq(req, res, next, hash, query, false);
    }

    // Production mode: every request must carry an allowlisted hash.
    if (!hash) {
      this.writeError(res, 'PersistedQueryNotFound', 'PERSISTED_QUERY_NOT_FOUND');
      return;
    }

    if (!this.allowlistHashes.has(hash)) {
      this.writeError(res, 'PersistedQueryNotFound', 'PERSISTED_QUERY_NOT_FOUND');
      return;
    }

    return this.processApq(req, res, next, hash, query, true);
  }

  private async processApq(
    req: PersistedQueryRequest,
    res: Response,
    next: NextFunction,
    hash: string,
    query: string | undefined,
    useStaticFallback: boolean,
  ): Promise<void> {
    const key = `graphql:apq:${hash}`;

    if (query) {
      const actualHash = createHash('sha256').update(query).digest('hex');
      if (actualHash !== hash) {
        this.writeError(res, 'Persisted query hash mismatch', 'PERSISTED_QUERY_HASH_MISMATCH');
        return;
      }

      if (!this.registrationEnabled && !this.allowlistHashes.has(hash)) {
        this.writeError(
          res,
          'Persisted query hash is not allowlisted',
          'PERSISTED_QUERY_NOT_ALLOWLISTED',
        );
        return;
      }

      await this.redis.set(key, query, this.ttlSeconds);
      return next();
    }

    const storedQuery =
      (await this.redis.get<string>(key)) ??
      (useStaticFallback ? this.allowlistBodies.get(hash) : undefined);

    if (!storedQuery) {
      this.writeError(res, 'PersistedQueryNotFound', 'PERSISTED_QUERY_NOT_FOUND');
      return;
    }

    req.body = { ...req.body, query: storedQuery };
    next();
  }

  private writeError(res: Response, message: string, code: string): void {
    res.status(400).json({
      errors: [
        {
          message,
          extensions: {
            code,
          },
        },
      ],
    });
  }

  private static loadAllowlistFile(config: ConfigService): Map<string, string> {
    const bodies = new Map<string, string>();
    const filePath = join(process.cwd(), 'src/graphql/persisted-query-allowlist.json');

    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      // File not present; treat as empty allowlist.
      return bodies;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return bodies;
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [hash, body] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof body === 'string') {
          bodies.set(hash, body);
        }
      }
    }

    return bodies;
  }
}
