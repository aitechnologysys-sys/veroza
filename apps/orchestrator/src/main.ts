import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('orchestrator', true);
import 'source-map-support/register';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
dayjs.extend(utc);

import { NestFactory } from '@nestjs/core';
import { armStartupWatchdog } from '@gitroom/nestjs-libraries/helpers/startup.watchdog';
import { AppModule } from '@gitroom/orchestrator/app.module';
import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

// Armed before the Nest module graph is built, which is where the observed
// hang occurred: Temporal was never reached, so no worker ever polled and
// every queued post stalled while pm2 still reported `online`.
const disarmWatchdog = armStartupWatchdog('orchestrator');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = process.env.ORCHESTRATOR_PORT || 3002;
  await app.listen(port);
  disarmWatchdog();
  console.log(`Orchestrator health check listening on port ${port}`);
}

bootstrap().catch((e) => {
  // Previously unhandled: a rejection here left the failure to Node's default
  // handler with no indication of which service died.
  disarmWatchdog();
  console.error('Orchestrator failed to bootstrap', e);
  process.exit(1);
});
