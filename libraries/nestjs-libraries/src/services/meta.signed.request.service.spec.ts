import { createHmac } from 'crypto';
import {
  MetaSignedRequestService,
  META_APP_PROVIDERS,
} from '@gitroom/nestjs-libraries/services/meta.signed.request.service';

const FACEBOOK_SECRET = 'facebook-app-secret';
const INSTAGRAM_SECRET = 'instagram-app-secret';
const THREADS_SECRET = 'threads-app-secret';

const b64url = (value: Buffer | string) =>
  Buffer.from(value as any).toString('base64url');

/** Build a signed_request the way Meta does. */
const sign = (payload: object, secret: string) => {
  const encodedPayload = b64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(encodedPayload)
    .digest();
  return `${b64url(signature)}.${encodedPayload}`;
};

const validPayload = (userId = '1234567890') => ({
  algorithm: 'HMAC-SHA256',
  issued_at: Math.floor(Date.now() / 1000),
  user_id: userId,
});

describe('MetaSignedRequestService', () => {
  let service: MetaSignedRequestService;

  beforeEach(() => {
    process.env.FACEBOOK_APP_SECRET = FACEBOOK_SECRET;
    process.env.INSTAGRAM_APP_SECRET = INSTAGRAM_SECRET;
    process.env.THREADS_APP_SECRET = THREADS_SECRET;
    service = new MetaSignedRequestService();
  });

  // 1. Valid signature
  it('accepts a correctly signed request and returns the app-scoped user id', () => {
    const signed = sign(validPayload('fb-user-1'), FACEBOOK_SECRET);

    expect(service.verify(signed, 'FACEBOOK')).toEqual(
      expect.objectContaining({ app: 'FACEBOOK', userId: 'fb-user-1' })
    );
  });

  it('verifies each app against its own secret', () => {
    expect(
      service.verify(sign(validPayload('ig-1'), INSTAGRAM_SECRET), 'INSTAGRAM')
        ?.userId
    ).toBe('ig-1');
    expect(
      service.verify(sign(validPayload('th-1'), THREADS_SECRET), 'THREADS')
        ?.userId
    ).toBe('th-1');
  });

  // 2. Invalid signature
  it('rejects a tampered signature', () => {
    const signed = sign(validPayload(), FACEBOOK_SECRET);
    const [, payload] = signed.split('.');
    const forged = `${b64url('not-the-signature')}.${payload}`;

    expect(service.verify(forged, 'FACEBOOK')).toBeNull();
  });

  it('rejects a payload edited after signing', () => {
    const signed = sign(validPayload('victim'), FACEBOOK_SECRET);
    const [signature] = signed.split('.');
    const swapped = `${signature}.${b64url(
      JSON.stringify(validPayload('attacker'))
    )}`;

    expect(service.verify(swapped, 'FACEBOOK')).toBeNull();
  });

  // 3. Incorrect app secret
  it('rejects a request signed with another app secret', () => {
    const signedByThreads = sign(validPayload(), THREADS_SECRET);

    // Genuine request, wrong app: the IDs are not comparable across apps, so
    // accepting this would delete the wrong person's data.
    expect(service.verify(signedByThreads, 'FACEBOOK')).toBeNull();
    expect(service.verify(signedByThreads, 'INSTAGRAM')).toBeNull();
    expect(service.verify(signedByThreads, 'THREADS')).not.toBeNull();
  });

  it('rejects everything when the secret is not configured', () => {
    delete process.env.THREADS_APP_SECRET;
    const signed = sign(validPayload(), THREADS_SECRET);

    expect(service.verify(signed, 'THREADS')).toBeNull();
  });

  // Malformed input
  it.each([
    ['empty string', ''],
    ['no separator', 'abcdef'],
    ['too many parts', 'a.b.c'],
    ['empty payload', 'abc.'],
    ['empty signature', '.abc'],
    ['payload that is not json', `${b64url('sig')}.${b64url('nonsense')}`],
  ])('rejects a malformed signed_request (%s)', (_label, value) => {
    expect(service.verify(value as string, 'FACEBOOK')).toBeNull();
  });

  it('rejects a payload naming a different algorithm', () => {
    const signed = sign(
      { algorithm: 'HMAC-SHA1', user_id: '1' },
      FACEBOOK_SECRET
    );

    expect(service.verify(signed, 'FACEBOOK')).toBeNull();
  });

  it('rejects a correctly signed payload with no user id', () => {
    const signed = sign({ algorithm: 'HMAC-SHA256' }, FACEBOOK_SECRET);

    expect(service.verify(signed, 'FACEBOOK')).toBeNull();
  });

  // 5. Multi-tenant / cross-product identity isolation
  it('maps each app to only its own providers', () => {
    expect(service.providersFor('FACEBOOK')).toEqual([
      'facebook',
      'instagram',
    ]);
    expect(service.providersFor('INSTAGRAM')).toEqual([
      'instagram-standalone',
    ]);
    expect(service.providersFor('THREADS')).toEqual(['threads']);
  });

  it('never lets one app claim another app\'s providers', () => {
    const all = Object.values(META_APP_PROVIDERS).flat();
    const unique = new Set(all);

    expect(all.length).toBe(unique.size);
  });

  it('verifyAny resolves to the app that actually signed it', () => {
    expect(
      service.verifyAny(sign(validPayload('x'), INSTAGRAM_SECRET))?.app
    ).toBe('INSTAGRAM');
    expect(service.verifyAny(`${b64url('sig')}.${b64url('{}')}`)).toBeNull();
  });
});
