import {
  Controller,
  HttpException,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Stripe')
@Controller('/stripe')
export class StripeController {
  constructor(private readonly _stripeService: StripeService) {}

  @Post('/')
  stripe(@Req() req: RawBodyRequest<Request>) {
    const event = this._stripeService.validateRequest(
      req.rawBody,
      // @ts-ignore
      req.headers['stripe-signature'],
      process.env.STRIPE_SIGNING_KEY
    );

    // Invoice and dispute objects do not carry our subscription metadata, so the
    // "is this ours?" guard below cannot apply to them — they are resolved to an
    // organization by customer id inside the service instead.
    const bypassesMetadataCheck = [
      'invoice.payment_succeeded',
      'invoice.payment_failed',
      'charge.dispute.created',
      'charge.dispute.closed',
    ];

    // Maybe it comes from another stripe webhook
    if (
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      event?.data?.object?.metadata?.service !== 'postaryx' &&
      !bypassesMetadataCheck.includes(event.type)
    ) {
      return { ok: true };
    }
    try {
      switch (event.type) {
        case 'invoice.payment_succeeded':
          return this._stripeService.paymentSucceeded(event);
        case 'invoice.payment_failed':
          return this._stripeService.paymentFailed(event);
        case 'charge.dispute.created':
          return this._stripeService.disputeCreated(event);
        case 'charge.dispute.closed':
          return this._stripeService.disputeClosed(event);
        case 'customer.subscription.created':
          return this._stripeService.createSubscription(event);
        case 'customer.subscription.updated':
          return this._stripeService.updateSubscription(event);
        case 'customer.subscription.deleted':
          return this._stripeService.deleteSubscription(event);
        default:
          return { ok: true };
      }
    } catch (e) {
      throw new HttpException(e, 500);
    }
  }
}
