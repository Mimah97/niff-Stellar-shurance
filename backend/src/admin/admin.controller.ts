import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Request, Response } from 'express';
import { ClaimStatus, Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from './guards/admin-role.guard';
import { AdminService } from './admin.service';
import { AdminPoliciesService } from './admin-policies.service';
import { AuditService } from './audit.service';
import { AdminStatsService } from './admin-stats.service';
import { ReindexDto } from './dto/reindex.dto';
import { BackfillDto } from './dto/backfill.dto';
import { AuditQueryDto } from './dto/audit-query.dto';
import { FeatureFlagDto } from './dto/feature-flag.dto';
import { SetRateLimitDto, EnableOverrideDto } from './dto/rate-limit.dto';
import { BulkUpdateClaimsDto, BULK_UPDATE_MAX_BATCH } from './dto/bulk-update-claims.dto';
import { PrivacyService, PrivacyRequestType } from '../maintenance/privacy.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { QueueMonitorService } from '../queues/queue-monitor.service';
import { SolvencyMonitoringService } from '../maintenance/solvency-monitoring.service';
import { AdminTenantsService, CreateTenantDto, UpdateTenantDto } from './admin-tenants.service';

class PrivacyRequestDto {
  @IsString() subjectWalletAddress!: string;
  @IsEnum(['ANONYMIZE', 'DELETE']) requestType!: PrivacyRequestType;
  @IsOptional() @IsString() notes?: string;
}

class ClaimStatusOverrideDto {
  @IsEnum(ClaimStatus) newStatus!: ClaimStatus;
  @IsString() @IsNotEmpty() reason!: string;
}

type AdminRequest = Request & {
  user?: {
    walletAddress?: string;
    scope?: string;
    scopes?: string[];
  };
  adminIdentity?: {
    staffId?: string;
    email?: string;
    role?: string;
    scopes?: string[];
  };
};

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly adminService: AdminService,
    private readonly adminPoliciesService: AdminPoliciesService,
    private readonly auditService: AuditService,
    private readonly privacyService: PrivacyService,
    private readonly rateLimitService: RateLimitService,
    private readonly queueMonitor: QueueMonitorService,
    private readonly configService: ConfigService,
    private readonly solvencyMonitoringService: SolvencyMonitoringService,
    private readonly tenantsService: AdminTenantsService,
  ) {}

  /**
   * GET /admin/stats
   *
   * Aggregated platform metrics: policy counts, claim counts by status,
   * treasury balance (from Redis solvency snapshot), and indexer lag.
   * Response is cached in Redis with a short TTL (default: 30s).
   */
  @Get('stats')
  @ApiOperation({ summary: 'Aggregated platform metrics (cached)' })
  async getStats(@Req() req: AdminRequest) {
    const tenantId = (req as unknown as { tenantId?: string }).tenantId;
    return this.adminStatsService.getStats(tenantId);
  }

  /**
   * POST /admin/reindex
   *
   * Enqueues an async reindex job starting from the given ledger sequence.
   * Returns a jobId so operators can track progress via the queue dashboard.
   *
   * Requires: admin role + valid JWT.
   * Writes an immutable audit row with actor and full payload.
   */
  @Post('reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Enqueue a ledger reindex job from a given ledger' })
  async reindex(@Body() dto: ReindexDto, @Req() req: AdminRequest) {
    const actor = req.user?.walletAddress ?? 'unknown';
    const network =
      dto.network ?? this.configService.get<string>('STELLAR_NETWORK', 'testnet');
    const jobId = await this.adminService.enqueueReindex(dto.fromLedger, network);
    await this.auditService.write({
      actor,
      action: 'reindex',
      payload: { fromLedger: dto.fromLedger, network, jobId },
      ipAddress: req.ip,
    });
    return { jobId, fromLedger: dto.fromLedger, network, status: 'queued' };
  }

  /**
   * GET /admin/reindex/status
   *
   * Returns the latest reindex progress for a network, including percentage complete.
   */
  @Get('reindex/status')
  @ApiOperation({ summary: 'Get latest reindex progress for a network' })
  async getReindexStatus(@Query('network') networkParam?: string) {
    const network = networkParam ?? this.configService.get<string>('STELLAR_NETWORK', 'testnet');
    const status = await this.adminService.getReindexStatus(network);
    if (!status) {
      throw new NotFoundException(`No reindex progress found for network ${network}`);
    }
    return status;
  }

  /**
   * POST /admin/indexer/backfill
   *
   * Validates the ledger range, splits it into batches, and enqueues one
   * BullMQ backfill job per batch. Rejects ranges that exceed
   * MAX_BACKFILL_LEDGER_RANGE before any jobs are created.
   *
   * Idempotent: the underlying indexer uses upsert logic so replaying
   * already-processed ledgers does not create duplicate records.
   */
  @Post('indexer/backfill')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Enqueue backfill jobs for a ledger range' })
  async enqueueBackfill(@Body() dto: BackfillDto, @Req() req: AdminRequest) {
    if (dto.fromLedger > dto.toLedger) {
      throw new BadRequestException('fromLedger must be <= toLedger');
    }
    const maxRange = this.configService.get<number>('MAX_BACKFILL_LEDGER_RANGE', 100_000);
    const range = dto.toLedger - dto.fromLedger + 1;
    if (range > maxRange) {
      throw new BadRequestException(
        `Ledger range ${range} exceeds MAX_BACKFILL_LEDGER_RANGE (${maxRange})`,
      );
    }
    const network = dto.network ?? this.configService.get<string>('STELLAR_NETWORK', 'testnet');
    const batchSize = this.configService.get<number>('INDEXER_BATCH_SIZE', 50);
    const jobs = await this.adminService.enqueueBackfill(
      dto.fromLedger,
      dto.toLedger,
      network,
      batchSize,
    );
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.auditService.write({
      actor,
      action: 'indexer_backfill',
      payload: { fromLedger: dto.fromLedger, toLedger: dto.toLedger, network, jobCount: jobs.length },
      ipAddress: req.ip,
    });
    return { jobs, fromLedger: dto.fromLedger, toLedger: dto.toLedger, network, batchSize, status: 'queued' };
  }

  /**
   * GET /admin/indexer/backfill/:jobId
   *
   * Returns the current BullMQ state of a backfill job.
   */
  @Get('indexer/backfill/:jobId')
  @ApiOperation({ summary: 'Get backfill job status' })
  async getBackfillJob(@Param('jobId') jobId: string) {
    const job = await this.adminService.getBackfillJob(jobId);
    if (!job) {
      throw new NotFoundException(`Backfill job ${jobId} not found`);
    }
    return job;
  }

  /**
   * GET /admin/audits
   *
   * Cursor-paginated, filterable read of the immutable admin audit log.
   * Logs each access as a meta-audit entry.
   * Requires: admin role + valid JWT.
   */
  @Get('audits')
  @ApiOperation({ summary: 'Cursor-paginated admin audit log with filters' })
  async getAudits(@Query() query: AuditQueryDto, @Req() req: AdminRequest) {
    const actor = req.user?.walletAddress ?? 'unknown';
    // Meta-audit: log this access
    await this.auditService.write({
      actor,
      action: 'audit_log_read',
      payload: { cursor: query.cursor, limit: query.limit, action: query.action, actor: query.actor, from: query.from, to: query.to } as Prisma.InputJsonObject,
      ipAddress: req.ip,
    });
    return this.auditService.findAll(query);
  }

  /**
   * GET /admin/audits/export
   *
   * Streaming CSV export of the audit log for the given filters.
   * Logs each export as a meta-audit entry.
   * Requires: admin role + valid JWT.
   */
  @Get('audits/export')
  @ApiOperation({ summary: 'Streaming CSV export of the audit log' })
  async exportAudits(
    @Query() query: AuditQueryDto,
    @Req() req: AdminRequest,
    @Res() res: Response,
  ) {
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.auditService.write({
      actor,
      action: 'audit_log_export',
      payload: { action: query.action, actor: query.actor, from: query.from, to: query.to } as Prisma.InputJsonObject,
      ipAddress: req.ip,
    });
    await this.auditService.streamCsv(
      { action: query.action, actor: query.actor, from: query.from, to: query.to },
      res,
    );
  }

  /**
   * GET /admin/policies
   *
   * Indexed policies. Omit soft-deleted rows unless `include_deleted=true`.
   */
  @Get('policies')
  @ApiOperation({ summary: 'List indexed policies (optional include_deleted for compliance)' })
  async getAdminPolicies(@Query('include_deleted') includeDeleted?: string) {
    const inc = includeDeleted === 'true' || includeDeleted === '1';
    return this.adminPoliciesService.listPolicies(inc);
  }

  /**
   * DELETE /admin/policies/:holder/:policyId
   *
   * Soft-delete: sets `deleted_at` on policy, its claims, and their votes.
   * Does not remove `raw_events` (reindex integrity).
   */
  @Delete('policies/:holder/:policyId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a policy and dependent claims/votes' })
  async softDeletePolicy(
    @Param('holder') holder: string,
    @Param('policyId') policyIdParam: string,
    @Req() req: AdminRequest,
  ) {
    const policyId = Number(policyIdParam);
    if (!Number.isFinite(policyId) || policyId < 0) {
      throw new BadRequestException('policyId must be a non-negative number');
    }
    const result = await this.adminPoliciesService.softDeletePolicy(holder, policyId);
    if (!result) {
      throw new NotFoundException(`Policy ${holder}:${policyId} not found`);
    }
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.auditService.write({
      actor,
      action: 'policy_soft_delete',
      payload: {
        policyKey: result.id,
        deletedAt: result.deletedAt,
        alreadyDeleted: result.alreadyDeleted,
      },
      ipAddress: req.ip,
    });
    return result;
  }

  /**
   * POST /admin/claims/:id/override
   *
   * Force a non-terminal claim to a new off-chain status. Requires elevated
   * admin scope and writes the immutable audit row before mutating the claim.
   */
  @Post('claims/:id/override')
  @ApiOperation({ summary: 'Force a claim status transition with elevated admin scope' })
  async overrideClaimStatus(
    @Param('id') idParam: string,
    @Body() dto: ClaimStatusOverrideDto,
    @Req() req: AdminRequest,
  ) {
    this.requireElevatedScope(req);
    const claimId = Number(idParam);
    if (!Number.isInteger(claimId) || claimId < 0) {
      throw new BadRequestException('id must be a non-negative integer');
    }
    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('reason must be non-empty');
    }

    const actor =
      req.adminIdentity?.email ??
      req.adminIdentity?.staffId ??
      req.user?.walletAddress ??
      'unknown';
    const before = await this.adminService.getClaimForOverride(claimId);
    await this.auditService.write({
      actor,
      action: 'claim_status_override',
      payload: {
        claimId,
        oldStatus: before.status,
        newStatus: dto.newStatus,
        reason,
        requestBody: dto,
      },
      ipAddress: req.ip,
    });

    const updated = await this.adminService.overrideClaimStatus(claimId, dto.newStatus);
    this.sorobanService
      .tryEmitClaimStatusOverrideEvent({
        claimId,
        oldStatus: before.status,
        newStatus: dto.newStatus,
        reason,
        actor,
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Soroban claim override event emission failed for ${claimId}: ${msg}`);
      });

    return { claimId, oldStatus: before.status, newStatus: updated.status, status: 'updated' };
  }

  /**
   * GET /admin/feature-flags
   *
   * Lists all feature flags and their current state.
   */
  @Get('feature-flags')
  @ApiOperation({ summary: 'List all feature flags' })
  async listFeatureFlags() {
    return this.adminService.getFeatureFlags();
  }

  /**
   * POST /admin/feature-flags
   *
   * Creates a new feature flag. Key must be in the predefined allowlist.
   * Writes an immutable audit row.
   */
  @Post('feature-flags')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new feature flag (allowlisted keys only)' })
  async createFeatureFlag(@Body() dto: FeatureFlagDto & { key: string }, @Req() req: AdminRequest) {
    const actor = req.user?.walletAddress ?? 'unknown';
    const flag = await this.adminService.createFeatureFlag(dto.key, dto.enabled, dto.description, actor);
    await this.auditService.write({
      actor,
      action: 'feature_flag_create',
      payload: { key: dto.key, enabled: dto.enabled, description: dto.description },
      ipAddress: req.ip,
    });
    return flag;
  }

  /**
   * GET /admin/solvency
   *
   * Latest snapshot from Redis only (no live Soroban call). Populated by the
   * scheduled solvency job; may be null before the first successful run.
   */
  @Get('solvency')
  @ApiOperation({ summary: 'Cached solvency snapshot for dashboard (Redis only)' })
  async getSolvencySnapshot() {
    const snapshot = await this.solvencyMonitoringService.getLatestSnapshot();
    return { snapshot };
  }

  /**
   * PATCH /admin/feature-flags/:key
   *
   * Toggles a feature flag on or off.
   * Writes an immutable audit row with actor and full payload.
   *
   * Legal note: disabling flags that gate user-facing activity (e.g. claim
   * filing, policy creation) constitutes a staff-initiated pause of user
   * operations. Such actions must be authorised by a designated compliance
   * officer and are subject to applicable insurance-regulation obligations.
   * The audit row created here serves as the immutable record of that action.
   */
  /** POST /admin/privacy/requests — execute anonymization or deletion for a subject. */
  @Post('privacy/requests')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Submit a privacy request (anonymize or delete off-chain data)' })
  async submitPrivacyRequest(@Body() dto: PrivacyRequestDto, @Req() req: Request) {
    const actor = (req.user as { walletAddress?: string })?.walletAddress ?? 'unknown';
    return this.privacyService.handleRequest({
      subjectWalletAddress: dto.subjectWalletAddress,
      requestType: dto.requestType,
      requestedBy: actor,
      ipAddress: req.ip,
      notes: dto.notes,
    });
  }

  /** GET /admin/privacy/requests — list all privacy requests. */
  @Get('privacy/requests')
  @ApiOperation({ summary: 'List privacy requests' })
  async listPrivacyRequests(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.privacyService.listRequests(Number(page), Number(limit));
  }

  @Patch('feature-flags/:key')
  @ApiOperation({ summary: 'Set a feature flag value' })
  async setFeatureFlag(
    @Param('key') key: string,
    @Body() dto: FeatureFlagDto,
    @Req() req: AdminRequest,
  ) {
    const actor = req.user?.walletAddress ?? 'unknown';
    const flag = await this.adminService.setFeatureFlag(key, dto.enabled, dto.description, actor);
    await this.auditService.write({
      actor,
      action: 'feature_flag_update',
      payload: { key, enabled: dto.enabled, description: dto.description },
      ipAddress: req.ip,
    });
    return flag;
  }

  /**
   * POST /admin/rate-limits/:policyId
   *
   * Set custom rate limit for a policy.
   * Writes an immutable audit row with actor and full payload.
   */
  @Post('rate-limits/:policyId')
  @ApiOperation({ summary: 'Set custom rate limit for a policy' })
  async setRateLimit(
    @Param('policyId') policyId: string,
    @Body() dto: SetRateLimitDto,
    @Req() req: AdminRequest,
  ) {
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.rateLimitService.setLimit(policyId, dto.limit, actor);
    await this.auditService.write({
      actor,
      action: 'rate_limit_set',
      payload: { policyId, limit: dto.limit },
      ipAddress: req.ip,
    });
    return { policyId, limit: dto.limit, status: 'updated' };
  }

  /**
   * GET /admin/rate-limits/:policyId
   *
   * Get rate limit status for a policy.
   */
  @Get('rate-limits/:policyId')
  @ApiOperation({ summary: 'Get rate limit status for a policy' })
  async getRateLimitStatus(@Param('policyId') policyId: string) {
    return this.rateLimitService.getCounterState(policyId);
  }

  /**
   * POST /admin/rate-limits/:policyId/override
   *
   * Enable manual override for a policy during catastrophic events.
   * Writes an immutable audit row with actor and full payload.
   */
  @Post('rate-limits/:policyId/override')
  @ApiOperation({ summary: 'Enable manual override for a policy' })
  async enableOverride(
    @Param('policyId') policyId: string,
    @Body() dto: EnableOverrideDto,
    @Req() req: AdminRequest,
  ) {
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.rateLimitService.enableOverride(policyId, actor, dto.reason);
    await this.auditService.write({
      actor,
      action: 'rate_limit_override_enabled',
      payload: { policyId, reason: dto.reason },
      ipAddress: req.ip,
    });
    return { policyId, overrideActive: true };
  }

  /**
   * DELETE /admin/rate-limits/:policyId/override
   *
   * Disable manual override for a policy.
   * Writes an immutable audit row with actor and full payload.
   */
  @Delete('rate-limits/:policyId/override')
  @ApiOperation({ summary: 'Disable manual override for a policy' })
  async disableOverride(
    @Param('policyId') policyId: string,
    @Req() req: AdminRequest,
  ) {
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.rateLimitService.disableOverride(policyId, actor);
    await this.auditService.write({
      actor,
      action: 'rate_limit_override_disabled',
      payload: { policyId },
      ipAddress: req.ip,
    });
    return { policyId, overrideActive: false };
  }

  /** POST /admin/queues/:queue/jobs/:jobId/retry — replay a DLQ job */
  @Post('queues/:queue/jobs/:jobId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Replay a failed (DLQ) job by id' })
  async retryDlqJob(
    @Param('queue') queue: string,
    @Param('jobId') jobId: string,
    @Req() req: AdminRequest,
  ) {
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.queueMonitor.replayJob(queue, jobId);
    await this.auditService.write({
      actor,
      action: 'dlq_job_replayed',
      payload: { queue, jobId },
      ipAddress: req.ip,
    });
    return { queue, jobId, status: 'retried' };
  }

  /**
   * GET /admin/claims/search
   *
   * Search claims with full-text search and filtering.
   * Supports: q (text search), status, claimant, policyId, dateFrom, dateTo
   * Returns cursor-paginated results with total count.
   */
  @Get('claims/search')
  @ApiOperation({ summary: 'Search claims with filters and full-text search' })
  async searchClaims(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('claimant') claimant?: string,
    @Query('policyId') policyId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.searchClaims({
      q,
      status,
      claimant,
      policyId,
      dateFrom,
      dateTo,
      after,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /**
   * GET /admin/policies/export
   *
   * Stream policies as CSV with optional filtering.
   * Supports: status, holderAddress, policyType, dateFrom, dateTo
   * Returns streaming CSV response.
   */
  @Get('policies/export')
  @ApiOperation({ summary: 'Export policies as CSV with filters' })
  async exportPolicies(
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('holderAddress') holderAddress?: string,
    @Query('policyType') policyType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const actor = req.user?.walletAddress ?? 'unknown';

    // Write audit log entry
    await this.auditService.write({
      actor,
      action: 'policies_exported',
      payload: { status, holderAddress, policyType, dateFrom, dateTo },
      ipAddress: req.ip,
    });

    // Generate CSV
    const csv = await this.adminService.exportPoliciesCSV({
      status,
      holderAddress,
      policyType,
      dateFrom,
      dateTo,
    });

    // Stream response
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="policies.csv"');
    res.send(csv);
  }
}
