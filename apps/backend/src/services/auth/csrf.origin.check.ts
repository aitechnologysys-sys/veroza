import { Request } from 'express';

// Postaryx: cross-site request forgery guard for cookie-authenticated calls.
//
// The `auth` cookie is SameSite=None, so a browser attaches it to a request
// that any other site starts, e.g. an auto-submitting form that POSTs to
// /user/delete-account. Browsers always send `Origin` (and modern ones
// `Sec-Fetch-Site`) on such requests, so a state-changing request that rides
// on the cookie must come from one of our own frontends.
//
// Requests that authenticate with the `auth` header (NOT_SECURED mode, server
// to server) carry no ambient credentials and are not affected, and neither
// are requests with no browser origin information at all (curl, Next.js
// server-side fetches, webhooks).

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

const toOrigin = (value?: string) => {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value.trim()).origin.toLowerCase();
  } catch {
    return undefined;
  }
};

export const trustedBrowserOrigins = () =>
  [
    process.env.FRONTEND_URL,
    process.env.MAIN_URL,
    process.env.CANVA_APP_ORIGIN,
  ]
    .map(toOrigin)
    .filter((origin): origin is string => !!origin);

export const isCrossSiteCookieRequest = (req: Request) => {
  if (SAFE_METHODS.includes(req.method.toUpperCase())) {
    return false;
  }

  // Only requests that ride on the cookie can be forged
  if (req.headers.auth || !req.cookies?.auth) {
    return false;
  }

  const origin = req.headers.origin;
  if (origin) {
    // `Origin: null` (sandboxed frames, data: URLs) never matches
    return !trustedBrowserOrigins().includes(origin.toLowerCase());
  }

  // No Origin: fall back to Fetch Metadata where the browser sends it
  return req.headers['sec-fetch-site'] === 'cross-site';
};
