import {
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import {
  MAX_UPLOAD_SIZE,
  maxUploadSizeFor,
  maxUploadSizeLabelFor,
} from '@gitroom/helpers/utils/max.upload.size';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer } = require('file-type');

const ALLOWED_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
]);

// multer (busboy) rejects a file that reaches `fileSize`, so allow one extra byte
// to accept files of exactly MAX_UPLOAD_SIZE. The pipe below applies the per-type limit.
export const UPLOAD_LIMITS = { fileSize: MAX_UPLOAD_SIZE + 1 };

@Injectable()
export class CustomFileValidationPipe implements PipeTransform {
  async transform(value: any) {
    if (!value || typeof value !== 'object') {
      return value;
    }

    // Skip non-file parameters (org, body, query, etc.)
    if (!('buffer' in value) && !('mimetype' in value) && !('fieldname' in value)) {
      return value;
    }

    if (!value.buffer || !Buffer.isBuffer(value.buffer)) {
      throw new BadRequestException('Invalid file upload.');
    }

    const detected = await fromBuffer(value.buffer);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      throw new BadRequestException('Unsupported file type.');
    }

    if (value.size > maxUploadSizeFor(detected.mime)) {
      throw new BadRequestException(
        `File is too large. The maximum size is ${maxUploadSizeLabelFor(detected.mime)}.`
      );
    }

    value.mimetype = detected.mime;
    const safeBase = (value.originalname || 'upload')
      .replace(/\.[^./\\]*$/, '')
      .replace(/[\\/]/g, '_')
      .slice(0, 100) || 'upload';
    value.originalname = `${safeBase}.${detected.ext}`;

    return value;
  }
}
