import {
  Controller,
  HttpException,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { PolarService } from '@gitroom/nestjs-libraries/services/polar.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Polar')
@Controller('/payment-webhook')
export class PolarController {
  constructor(private readonly _polarService: PolarService) {}

  @Post('/')
  async polar(@Req() req: RawBodyRequest<Request>) {
    const rawHeaders = req.headers as any;
    const headers: Record<string, string> = {
      'webhook-id': rawHeaders['webhook-id'] as string,
      'webhook-timestamp': rawHeaders['webhook-timestamp'] as string,
      'webhook-signature': rawHeaders['webhook-signature'] as string,
    };

    let event: any;
    try {
      event = this._polarService.validateWebhook(req.rawBody, headers);
    } catch (e) {
      throw new HttpException('Invalid webhook signature', 400);
    }

    try {
      switch (event.type) {
        case 'subscription.created':
          return this._polarService.handleSubscriptionCreated(event);
        case 'subscription.updated':
          return this._polarService.handleSubscriptionUpdated(event);
        case 'subscription.canceled':
        case 'subscription.revoked':
          return this._polarService.handleSubscriptionDeleted(event);
        case 'order.created':
          return this._polarService.handlePaymentSucceeded(event);
        default:
          return { ok: true };
      }
    } catch (e) {
      throw new HttpException(e, 500);
    }
  }
}
