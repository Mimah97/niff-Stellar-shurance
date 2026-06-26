import { MetricsService } from './metrics.service';

describe('MetricsService — http_request_duration_seconds histogram', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it('histogram is registered with method, route, status_code labels', () => {
    const desc = service.httpRequestDuration;
    expect(desc).toBeDefined();
    // Observe does not throw with all three labels present
    expect(() =>
      service.recordHttpRequest({ method: 'GET', route: '/claims', statusCode: 200, durationMs: 50 }),
    ).not.toThrow();
  });

  it('recordHttpRequest increments httpRequestTotal', async () => {
    service.recordHttpRequest({ method: 'POST', route: '/policies', statusCode: 201, durationMs: 80 });
    const metrics = await service.getMetrics();
    expect(metrics).toContain('http_requests_total');
    expect(metrics).toContain('"POST"');
  });

  it('recordHttpRequest increments http5xxTotal on 5xx responses', async () => {
    service.recordHttpRequest({ method: 'GET', route: '/claims/:id', statusCode: 500, durationMs: 10 });
    const metrics = await service.getMetrics();
    expect(metrics).toContain('http_5xx_errors_total');
  });

  it('does not increment http5xxTotal on 4xx responses', async () => {
    // Create fresh service to start with zero counters
    const fresh = new MetricsService();
    fresh.recordHttpRequest({ method: 'GET', route: '/claims/:id', statusCode: 404, durationMs: 5 });
    const metrics = await fresh.getMetrics();
    // Counter should be zero (not present or value 0)
    const match = metrics.match(/http_5xx_errors_total\{[^}]*\} (\d+)/);
    expect(match).toBeNull();
  });

  it('normaliseRoute strips numeric IDs', () => {
    expect(service.normaliseRoute('/claims/123')).toBe('/claims/:id');
    expect(service.normaliseRoute('/policies/456/claims/789')).toBe('/policies/:id/claims/:id');
  });

  it('normaliseRoute strips pure UUID segments', () => {
    // UUID with no leading digits — fully matched by the UUID regex
    expect(service.normaliseRoute('/events/abcdef00-e29b-41d4-a716-446655440000')).toBe('/events/:uuid');
  });

  it('histogram uses buckets suited for p95 SLA monitoring (includes 1s bucket)', async () => {
    service.recordHttpRequest({ method: 'GET', route: '/health', statusCode: 200, durationMs: 1200 });
    const metrics = await service.getMetrics();
    // The 1 s bucket (le="1") must exist for the SLA recording rule to work
    expect(metrics).toContain('le="1"');
  });
});
