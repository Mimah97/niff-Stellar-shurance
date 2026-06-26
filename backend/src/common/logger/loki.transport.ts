import * as https from 'https';
import * as http from 'http';
import * as url from 'url';
// winston-transport is a CommonJS module exported as module.exports = TransportStream.
// The import-equals syntax is the correct TypeScript way to import such modules.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import TransportStream = require('winston-transport');

export interface LokiTransportOptions {
  level?: string;
  lokiUrl: string;
  authToken?: string;
  flushIntervalMs?: number;
  batchSize?: number;
  labels?: Record<string, string>;
}

interface LokiStream {
  stream: Record<string, string>;
  values: [string, string][];
}

interface LokiPushBody {
  streams: LokiStream[];
}

type BufferedEntry = [string, string];

/**
 * Minimal Winston transport that ships structured JSON log lines to a
 * Loki-compatible HTTP push endpoint (POST /loki/api/v1/push).
 *
 * Uses only Node.js built-in modules (http/https/url) — no extra npm packages.
 *
 * Logs are buffered in memory and flushed either:
 *  - every `flushIntervalMs` milliseconds (default 5 000 ms), or
 *  - whenever the buffer reaches `batchSize` entries (default 100).
 *
 * On process exit the buffer is flushed synchronously via a best-effort
 * fire-and-forget request so that in-flight logs are not silently dropped.
 */
export class LokiTransport extends TransportStream {
  private readonly lokiUrl: string;
  private readonly authToken: string | undefined;
  private readonly batchSize: number;
  private readonly labels: Record<string, string>;
  private buffer: BufferedEntry[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly parsedUrl: url.UrlWithStringQuery;

  constructor(opts: LokiTransportOptions) {
    super({ level: opts.level });
    this.lokiUrl = opts.lokiUrl;
    this.authToken = opts.authToken;
    this.batchSize = opts.batchSize ?? 100;
    this.labels = {
      service: 'niffyinsure-api',
      ...(opts.labels ?? {}),
    };
    this.parsedUrl = url.parse(this.lokiUrl);

    const flushIntervalMs = opts.flushIntervalMs ?? 5000;
    this.timer = setInterval(() => void this.flush(), flushIntervalMs).unref();

    process.on('beforeExit', () => void this.flush());
    process.on('SIGTERM', () => void this.flush());
    process.on('SIGINT', () => void this.flush());
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log(info: any, callback: () => void): void {
    setImmediate(() => this.emit('logged', info));
    const timestampNs = `${Date.now()}000000`;
    const line = typeof info.message === 'string' ? info.message : JSON.stringify(info);
    this.buffer.push([timestampNs, line]);
    if (this.buffer.length >= this.batchSize) {
      void this.flush();
    }
    callback();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const entries = this.buffer.splice(0);
    const body: LokiPushBody = {
      streams: [{ stream: this.labels, values: entries }],
    };
    await this.sendBatch(body).catch(() => {
      // Swallow errors — observability must never crash the application.
    });
  }

  private sendBatch(body: LokiPushBody): Promise<void> {
    return new Promise((resolve) => {
      const payload = JSON.stringify(body);
      const isHttps = this.parsedUrl.protocol === 'https:';
      const transport = isHttps ? https : http;
      const options: http.RequestOptions = {
        hostname: this.parsedUrl.hostname ?? 'localhost',
        port: this.parsedUrl.port ?? (isHttps ? 443 : 80),
        path: this.parsedUrl.path ?? '/loki/api/v1/push',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(this.authToken
            ? { Authorization: `Bearer ${this.authToken}` }
            : {}),
        },
      };
      const req = transport.request(options, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', () => resolve());
      req.setTimeout(5000, () => {
        req.destroy();
        resolve();
      });
      req.write(payload);
      req.end();
    });
  }

  close(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    void this.flush();
  }
}
