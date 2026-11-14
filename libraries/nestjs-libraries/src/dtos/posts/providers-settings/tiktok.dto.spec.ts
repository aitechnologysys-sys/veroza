import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TikTokDto } from './tiktok.dto';

const base = {
  privacy_level: 'SELF_ONLY',
  duet: false,
  stitch: false,
  comment: false,
  autoAddMusic: 'no',
  brand_content_toggle: false,
  brand_organic_toggle: false,
  content_posting_method: 'DIRECT_POST',
};

const errorsFor = async (settings: Record<string, unknown>) => {
  const errors = await validate(
    plainToInstance(TikTokDto, { ...base, ...settings }) as object
  );
  return errors.flatMap((e) => Object.values(e.constraints || {}));
};

describe('TikTokDto (TikTok Content Sharing Guidelines)', () => {
  it('accepts a valid private direct post', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it('requires a privacy level for direct posts (no default)', async () => {
    expect(await errorsFor({ privacy_level: '' })).toContain(
      'Choose who can see this video.'
    );
  });

  it('does not require a privacy level for upload-to-inbox posts', async () => {
    expect(
      await errorsFor({ privacy_level: '', content_posting_method: 'UPLOAD' })
    ).toEqual([]);
  });

  it('rejects private branded content', async () => {
    expect(
      await errorsFor({
        disclose: true,
        brand_content_toggle: true,
        privacy_level: 'SELF_ONLY',
      })
    ).toContain('Branded content visibility cannot be set to private.');
  });

  it('requires a disclosure choice when disclosure is on', async () => {
    expect(await errorsFor({ disclose: true })).toContain(
      'You need to indicate if your content promotes yourself, a third party, or both.'
    );
    expect(
      await errorsFor({ disclose: true, brand_organic_toggle: true })
    ).toEqual([]);
  });

  it("enforces the creator's max video duration", async () => {
    expect(
      await errorsFor({
        video_duration_sec: 601.2,
        max_video_post_duration_sec: 600,
      })
    ).toContain(
      'This video is 602 seconds long. This TikTok account can post videos up to 600 seconds.'
    );
    expect(
      await errorsFor({
        video_duration_sec: 12,
        max_video_post_duration_sec: 600,
      })
    ).toEqual([]);
  });

  it('blocks posting when creator_info reported an error', async () => {
    expect(
      await errorsFor({ creator_info_error: 'Daily post limit reached' })
    ).toContain('Daily post limit reached');
  });
});
