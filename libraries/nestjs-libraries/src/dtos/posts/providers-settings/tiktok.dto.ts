import {
  IsBoolean,
  ValidateIf,
  IsIn,
  IsString,
  MaxLength,
  IsOptional,
  IsDefined,
  IsNumber,
  Min,
  Max,
  ValidateNested,
  ValidateBy,
  ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JSONSchema } from 'class-validator-jsonschema';

export class TikTokMusic {
  @IsDefined()
  @IsString()
  @JSONSchema({
    description:
      'The commercial music library track id, taken from the "id" returned by the musicSearch function.',
  })
  id: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  artist?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  audio_volume?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  video_volume?: number;
}

export class TikTokLocation {
  @IsDefined()
  @IsString()
  @JSONSchema({
    description:
      'The location tag id, taken from the "id" returned by the locationSearch function.',
  })
  id: string;

  @IsDefined()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  address?: string;
}

// TikTok only honors most of these settings on a DIRECT_POST. With
// content_posting_method=UPLOAD the media lands in the user's TikTok inbox as a
// draft, and TikTok's inbox/upload endpoints accept nothing but the title /
// description - every other field below is silently discarded.
// video_made_with_ai / duet / stitch are additionally video-only: TikTok's photo
// post_info has no is_aigc, disable_duet or disable_stitch field.
// music / location are TikTok Business only: the legacy TikTok provider ignores
// them (its Content Posting API has no music_sound_info / location fields).
// Fields stay required here (existing clients depend on it); the constraints are
// documented, not enforced.
// Rules from TikTok's Content Sharing Guidelines (required for the Content
// Posting API audit) that depend on more than one field.

// When "Disclose video content" is on, the creator must say who is promoted.
const RequiresDisclosureChoice = () =>
  ValidateBy({
    name: 'tiktokRequiresDisclosureChoice',
    validator: {
      validate: (value: unknown, args: ValidationArguments) => {
        const o = args.object as TikTokDto;
        return !value || !!o.brand_organic_toggle || !!o.brand_content_toggle;
      },
      defaultMessage: () =>
        'You need to indicate if your content promotes yourself, a third party, or both.',
    },
  });

// Branded content cannot be posted privately.
const NotPrivateWhenBranded = () =>
  ValidateBy({
    name: 'tiktokNotPrivateWhenBranded',
    validator: {
      validate: (value: unknown, args: ValidationArguments) => {
        const o = args.object as TikTokDto;
        return !(o.brand_content_toggle && value === 'SELF_ONLY');
      },
      defaultMessage: () =>
        'Branded content visibility cannot be set to private.',
    },
  });

// The video must not exceed the creator's max_video_post_duration_sec
// (returned by creator_info/query; both values are filled in by the panel).
const WithinCreatorMaxDuration = () =>
  ValidateBy({
    name: 'tiktokWithinCreatorMaxDuration',
    validator: {
      validate: (value: unknown, args: ValidationArguments) => {
        const o = args.object as TikTokDto;
        return (
          !o.max_video_post_duration_sec ||
          !value ||
          (value as number) <= o.max_video_post_duration_sec
        );
      },
      defaultMessage: (args: ValidationArguments) => {
        const o = args.object as TikTokDto;
        return `This video is ${Math.ceil(
          o.video_duration_sec
        )} seconds long. This TikTok account can post videos up to ${
          o.max_video_post_duration_sec
        } seconds.`;
      },
    },
  });

// creator_info/query said this creator cannot post right now.
const NoCreatorInfoError = () =>
  ValidateBy({
    name: 'tiktokNoCreatorInfoError',
    validator: {
      validate: (value: unknown) => !value,
      defaultMessage: (args: ValidationArguments) => String(args.value),
    },
  });

export class TikTokDto {
  @ValidateIf((p) => p.title)
  @MaxLength(90)
  @JSONSchema({
    description:
      'Used as the title of the post. The only setting TikTok keeps when content_posting_method=UPLOAD.',
  })
  title: string;

  // Required for direct posts, with no default: the creator must choose
  // (TikTok Content Sharing Guidelines). Inbox uploads set privacy in the app.
  @ValidateIf((p) => p.content_posting_method !== 'UPLOAD')
  @IsIn(
    [
      'PUBLIC_TO_EVERYONE',
      'MUTUAL_FOLLOW_FRIENDS',
      'FOLLOWER_OF_CREATOR',
      'SELF_ONLY',
    ],
    { message: 'Choose who can see this video.' }
  )
  @NotPrivateWhenBranded()
  @JSONSchema({
    description:
      'Required for DIRECT_POST, with no default. Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  privacy_level:
    | 'PUBLIC_TO_EVERYONE'
    | 'MUTUAL_FOLLOW_FRIENDS'
    | 'FOLLOWER_OF_CREATOR'
    | 'SELF_ONLY';

  @IsBoolean()
  @JSONSchema({
    description:
      'Video posts only, and only when content_posting_method=DIRECT_POST. TikTok has no duet setting for photo posts.',
  })
  duet: boolean;

  @IsBoolean()
  @JSONSchema({
    description:
      'Video posts only, and only when content_posting_method=DIRECT_POST. TikTok has no stitch setting for photo posts.',
  })
  stitch: boolean;

  @IsBoolean()
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  comment: boolean;

  @IsIn(['yes', 'no'])
  @JSONSchema({
    description:
      'Photo posts only, and only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD. ' +
      'On TikTok Business, "yes" attaches a random commercial music library track and overrides the music setting; ' +
      'on legacy TikTok, "yes" lets TikTok auto-add its recommended music.',
  })
  autoAddMusic: 'yes' | 'no';

  @IsOptional()
  @IsBoolean()
  @RequiresDisclosureChoice()
  disclose?: boolean;

  @IsBoolean()
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  brand_content_toggle: boolean;

  @IsBoolean()
  @IsOptional()
  @JSONSchema({
    description:
      'Labels the post as AI generated. Video posts only, and only when content_posting_method=DIRECT_POST. TikTok has no AI-generated label for photo posts, and discards it on UPLOAD.',
  })
  video_made_with_ai: boolean;

  @IsBoolean()
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  brand_organic_toggle: boolean;

  @Type(() => TikTokMusic)
  @ValidateNested()
  @IsOptional()
  @JSONSchema({
    description:
      'TikTok Business only, and only when content_posting_method=DIRECT_POST. Attaches a commercial music library track to the post (use the musicSearch function to find one). audio_volume / video_volume apply to video posts only. For photos, ignored when autoAddMusic is "yes" (a random track is attached instead).',
  })
  music?: TikTokMusic;

  @Type(() => TikTokLocation)
  @ValidateNested()
  @IsOptional()
  @JSONSchema({
    description:
      'TikTok Business only, and only when content_posting_method=DIRECT_POST. Tags the post with a location (use the locationSearch function to find one).',
  })
  location?: TikTokLocation;

  @IsIn(['DIRECT_POST', 'UPLOAD'])
  @IsString()
  @JSONSchema({
    description:
      'Required. Use "DIRECT_POST" to actually publish the post to TikTok. ' +
      '"UPLOAD" does NOT publish: it only sends the media to the user\'s TikTok app inbox, ' +
      'where they must manually finish and publish it within 24 hours or it is discarded, ' +
      'and it makes TikTok ignore every other setting here. ' +
      'Only use "UPLOAD" when the user explicitly asks to review or edit the post inside the TikTok app before publishing.',
  })
  content_posting_method: 'DIRECT_POST' | 'UPLOAD';

  // Filled in by the settings panel from creator_info/query and the selected
  // video's metadata; not sent to TikTok.
  @IsOptional()
  @IsNumber()
  max_video_post_duration_sec?: number;

  @IsOptional()
  @IsNumber()
  @WithinCreatorMaxDuration()
  video_duration_sec?: number;

  @IsOptional()
  @NoCreatorInfoError()
  creator_info_error?: string;
}
