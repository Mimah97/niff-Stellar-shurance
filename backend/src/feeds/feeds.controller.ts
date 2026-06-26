import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { FeedsService } from './feeds.service';

/**
 * Public feed endpoints — no auth required.
 * Excluded from Swagger: these are machine-readable feeds, not API endpoints.
 */
@ApiExcludeController()
@Controller('feeds')
export class FeedsController {
  constructor(private readonly feedsService: FeedsService) {}

  /**
   * GET /feeds/claims.atom
   *
   * Atom 1.0 feed of the 50 most recently finalized claims (approved or rejected).
   * Useful for community monitoring tools and transparency dashboards.
   *
   * Cache-Control is set to 5 minutes — finalization is an infrequent event.
   */
  @Get('claims.atom')
  async claimsAtom(@Res() res: Response): Promise<void> {
    const xml = await this.feedsService.buildClaimsAtomFeed();
    res.set('Content-Type', 'application/atom+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    res.end(xml);
  }
}
