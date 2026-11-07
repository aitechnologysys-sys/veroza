import { HttpException, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  PaymentPlatform,
  PaymentProviderAbstract,
} from '@gitroom/nestjs-libraries/services/payment/payment.provider.interface';

@Injectable()
export class PaymentProviderManager {
  constructor(private _moduleRef: ModuleRef) {}

  private metadata(): { target: any; provider: string }[] {
    return (
      Reflect.getMetadata('payment-provider', PaymentProviderAbstract) || []
    );
  }

  getProvider(provider: string): PaymentProviderAbstract {
    const found = this.metadata().find((m) => m.provider === provider);

    if (!found) {
      throw new HttpException(`Payment provider ${provider} not found`, 400);
    }

    return this._moduleRef.get(found.target, { strict: false });
  }

  getProviders(): { name: string; provider: PaymentProviderAbstract }[] {
    return this.metadata().map((m) => ({
      name: m.provider,
      provider: this._moduleRef.get(m.target, { strict: false }),
    }));
  }

  // First registered provider of a platform is the one new subscriptions use
  getDefaultProvider(platform: PaymentPlatform) {
    const providers = this.getProviders().filter(
      (p) => p.provider.platform === platform
    );
    // Postaryx: with Stripe and Polar both registered for web, BILLING_PROVIDER
    // (default "stripe") chooses which one takes new web checkouts instead of
    // registration order. See CLAUDE.md "Billing".
    const preferred = process.env.BILLING_PROVIDER || 'stripe';
    const found =
      providers.find((p) => p.name === preferred) || providers[0];

    if (!found) {
      throw new Error(`No payment provider registered for ${platform}`);
    }

    return found;
  }
}
