import {
  Controller,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  HttpException,
  Logger,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Response } from "express";
import { HorizonService } from "./horizon.service";
import { HorizonTransactionResponse } from "./dto/horizon-transaction.dto";

@Controller("horizon")
export class HorizonController {
  private readonly logger = new Logger(HorizonController.name);

  constructor(private readonly horizonService: HorizonService) {}

  /**
   * GET /api/horizon/transactions?account=<address>&cursor=<paging_token>&limit=<n>
   *
   * Proxies operation history from Horizon filtered to payment-relevant types.
   * Rate limited to 30 requests per 60 seconds per wallet address.
   */
  @Get("transactions")
  @HttpCode(HttpStatus.OK)
  async getTransactions(
    @Query("account") account: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limitStr?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<HorizonTransactionResponse> {
    if (!account) {
      throw new HttpException(
        "account query parameter is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    if (isNaN(limit)) {
      throw new HttpException("limit must be a number", HttpStatus.BAD_REQUEST);
    }

    const rl = await this.horizonService.checkRateLimit(account);
    if (!rl.allowed) {
      res?.setHeader("Retry-After", String(rl.retryAfterSeconds));
      throw new HttpException(
        {
          statusCode: 429,
          error: "Too Many Requests",
          message: "Rate limit exceeded for this account. Please slow down.",
          retryAfter: rl.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      return await this.horizonService.getTransactions(account, cursor, limit);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        const retryAfter = (err as any).retryAfter;
        if (retryAfter) {
          res?.setHeader("Retry-After", String(retryAfter));
        }
      }
      throw err;
    }
  }
}
