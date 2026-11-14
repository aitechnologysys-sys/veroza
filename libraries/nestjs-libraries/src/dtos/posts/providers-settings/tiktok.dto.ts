import {
  IsBoolean,
  ValidateIf,
  IsIn,
  IsString,
  MaxLength,
  IsOptional,
  IsNumber,
  ValidateBy,
  ValidationArguments,
} from 'class-validator';

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
  title: string;

  // Required for direct posts, with no default: the creator must choose.
  // Upload-to-inbox posts set privacy inside the TikTok app instead.
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
  privacy_level:
    | 'PUBLIC_TO_EVERYONE'
    | 'MUTUAL_FOLLOW_FRIENDS'
    | 'FOLLOWER_OF_CREATOR'
    | 'SELF_ONLY';

  @IsBoolean()
  duet: boolean;

  @IsBoolean()
  stitch: boolean;

  @IsBoolean()
  comment: boolean;

  @IsIn(['yes', 'no'])
  autoAddMusic: 'yes' | 'no';

  @IsOptional()
  @IsBoolean()
  @RequiresDisclosureChoice()
  disclose?: boolean;

  @IsBoolean()
  brand_content_toggle: boolean;

  @IsBoolean()
  @IsOptional()
  video_made_with_ai: boolean;

  @IsBoolean()
  brand_organic_toggle: boolean;

  @IsIn(['DIRECT_POST', 'UPLOAD'])
  @IsString()
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
