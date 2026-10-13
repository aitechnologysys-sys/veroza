import {
  summarizeError,
  logProviderError,
  redactDeep,
  redactSecretsInString,
} from '@gitroom/nestjs-libraries/helpers/redact';

/** An axios-shaped error: the exact structure that leaked tokens before. */
const axiosLikeError = () => {
  const err: any = new Error(
    'Request failed with status code 401 for https://api.example.com/me?access_token=SUPER_SECRET'
  );
  err.name = 'AxiosError';
  err.code = 'ERR_BAD_REQUEST';
  err.config = {
    url: 'https://api.example.com/me',
    method: 'get',
    headers: {
      Authorization: 'Bearer LEAKED_ACCESS_TOKEN',
      Cookie: 'session=LEAKED_COOKIE',
    },
    data: JSON.stringify({ password: 'hunter2', client_secret: 'SHHH' }),
  };
  err.request = { _header: 'GET /me\nAuthorization: Bearer LEAKED_ACCESS_TOKEN' };
  err.response = {
    status: 401,
    data: { error: 'invalid_token', access_token: 'ANOTHER_LEAK' },
    headers: { 'set-cookie': ['sid=LEAKED'] },
  };
  return err;
};

const FORBIDDEN = [
  'LEAKED_ACCESS_TOKEN',
  'LEAKED_COOKIE',
  'SUPER_SECRET',
  'hunter2',
  'SHHH',
  'ANOTHER_LEAK',
  'LEAKED',
];

describe('summarizeError', () => {
  it('keeps only triage-worthy fields', () => {
    expect(summarizeError(axiosLikeError())).toEqual({
      name: 'AxiosError',
      message: expect.stringContaining('Request failed with status code 401'),
      status: 401,
      code: 'ERR_BAD_REQUEST',
    });
  });

  it('never carries request headers, bodies or upstream payloads', () => {
    const serialized = JSON.stringify(summarizeError(axiosLikeError()));

    for (const secret of FORBIDDEN) {
      expect(serialized).not.toContain(secret);
    }
    // The carriers themselves must be absent, not merely scrubbed.
    for (const field of ['config', 'request', 'response', 'headers', 'stack']) {
      expect(serialized).not.toContain(field);
    }
  });

  it('redacts secrets embedded in the message', () => {
    const summary = summarizeError(axiosLikeError());

    expect(summary.message).not.toContain('SUPER_SECRET');
    expect(summary.message).toContain('[redacted]');
  });

  it('bounds an unbounded upstream message', () => {
    const err = new Error('x'.repeat(5000));

    expect(summarizeError(err).message.length).toBeLessThanOrEqual(300);
  });

  it('handles non-Error throwables', () => {
    expect(summarizeError('plain string')).toMatchObject({
      name: 'Error',
      message: 'plain string',
    });
    expect(summarizeError(undefined)).toMatchObject({ name: 'Error' });
    expect(summarizeError({ status: 503 })).toMatchObject({ status: 503 });
  });
});

describe('logProviderError', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('writes one structured line with the provider and operation', () => {
    logProviderError('bluesky', 'authenticate', axiosLikeError());

    const line = (console.error as jest.Mock).mock.calls[0][0];
    expect(JSON.parse(line)).toEqual(
      expect.objectContaining({
        event: 'provider_error',
        provider: 'bluesky',
        operation: 'authenticate',
        status: 401,
      })
    );
  });

  it('leaks nothing sensitive', () => {
    logProviderError('wordpress', 'authenticate', axiosLikeError());

    const line = (console.error as jest.Mock).mock.calls[0][0];
    for (const secret of FORBIDDEN) {
      expect(line).not.toContain(secret);
    }
  });
});

describe('redactSecretsInString', () => {
  it.each([
    ['https://cb?code=OAUTH&state=ok', 'OAUTH', 'state=ok'],
    ['?access_token=AAA&fields=id', 'AAA', 'fields=id'],
    ['signed_request=FORGED', 'FORGED', ''],
    ['client_secret=SHH;next=1', 'SHH', 'next=1'],
  ])('redacts %s', (input, secret, kept) => {
    const out = redactSecretsInString(input);

    expect(out).not.toContain(secret);
    if (kept) {
      expect(out).toContain(kept);
    }
  });

  it('leaves ordinary text alone', () => {
    expect(redactSecretsInString('posted 3 items to channel 7')).toBe(
      'posted 3 items to channel 7'
    );
  });
});

describe('redactDeep', () => {
  it('redacts by key through nesting and arrays', () => {
    const out = redactDeep({
      a: [{ token: 'x' }, { ok: 1 }],
      b: { c: { password: 'y', keep: 'z' } },
    });

    expect(out.a[0].token).toBe('[redacted]');
    expect(out.a[1].ok).toBe(1);
    expect(out.b.c.password).toBe('[redacted]');
    expect(out.b.c.keep).toBe('z');
  });

  it('stops at a depth bound instead of recursing forever', () => {
    const cyclic: any = { level: 1 };
    cyclic.self = cyclic;

    expect(() => redactDeep(cyclic)).not.toThrow();
  });
});
