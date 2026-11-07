import { IUploadProvider, UploadedStream } from './upload.interface';
import { createWriteStream, mkdirSync, unlink, writeFileSync } from 'fs';
import { resolve, sep } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { parseDataUrl } from '@gitroom/nestjs-libraries/upload/data.url';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fileTypeFromBuffer } = require('file-type');

const LOCAL_STORAGE_ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
]);
export class LocalStorage implements IUploadProvider {
  constructor(private uploadDirectory: string) {}

  // Files live under /YYYY/MM/DD with a random name; creates the folder
  private newFilePath(ext: string) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const innerPath = `/${year}/${month}/${day}`;
    const dir = `${this.uploadDirectory}${innerPath}`;
    mkdirSync(dir, { recursive: true });

    const randomName = Array(32)
      .fill(null)
      .map(() => Math.round(Math.random() * 16).toString(16))
      .join('');

    const filename = `${randomName}.${ext}`;
    return {
      filename,
      filePath: `${dir}/${filename}`,
      path: process.env.FRONTEND_URL + '/uploads' + `${innerPath}/${filename}`,
    };
  }

  async uploadSimple(path: string) {
    const dataUrl = path.startsWith('data:') ? parseDataUrl(path) : null;

    let body: Buffer;
    if (dataUrl) {
      body = dataUrl.buffer;
    } else {
      if (!(await isSafePublicHttpsUrl(path))) {
        throw new Error('Unsafe URL');
      }
      const loadImage = await fetch(path, {
        // @ts-ignore — undici option, not in lib.dom fetch types
        dispatcher: ssrfSafeDispatcher,
      });
      body = Buffer.from(await loadImage.arrayBuffer());
    }

    // Never trust the claimed mime/extension (data URL header, remote
    // content-type, or URL path): sniff the real type from the bytes and
    // only accept the allow-list, otherwise an attacker could write an
    // arbitrary file (e.g. .html/.svg with embedded script) into the
    // publicly served uploads directory on the app's own origin.
    const detected = await fileTypeFromBuffer(body);
    if (!detected || !LOCAL_STORAGE_ALLOWED_MIME.has(detected.mime)) {
      throw new Error('Unsupported file type.');
    }

    const { filePath, path: publicUrl } = this.newFilePath(detected.ext);
    // Logic to save the file to the filesystem goes here
    writeFileSync(filePath, body);

    return publicUrl;
  }

  async uploadFile(file: Express.Multer.File): Promise<any> {
    try {
      const detected = await fileTypeFromBuffer(file.buffer);
      if (!detected || !LOCAL_STORAGE_ALLOWED_MIME.has(detected.mime)) {
        throw new Error('Unsupported file type.');
      }
      const safeMime = detected.mime;

      const { filename, filePath, path } = this.newFilePath(detected.ext);
      writeFileSync(filePath, file.buffer);

      return {
        filename,
        path,
        mimetype: safeMime,
        originalname: filename,
      };
    } catch (err) {
      console.error('Error uploading file to Local Storage:', err);
      throw err;
    }
  }

  /**
   * Maps a stored public path back to its file on disk.
   *
   * `uploadFile` records `FRONTEND_URL + '/uploads' + innerPath`, so the
   * value held in the database is a URL, not a filesystem path — passing it
   * straight to `unlink` never matched anything. Everything up to and
   * including the `/uploads` segment is stripped and the remainder is
   * re-rooted at the upload directory.
   *
   * Returns null when the value does not resolve inside the upload
   * directory, so a crafted `path` cannot reach unrelated files.
   */
  private resolveLocalPath(filePath: string): string | null {
    if (!filePath) {
      return null;
    }

    const root = resolve(this.uploadDirectory);

    // A filesystem path already inside the upload directory (upstream's
    // streaming upload cleans up partial files this way) is used as is.
    const direct = resolve(filePath);
    if (direct.startsWith(root + sep)) {
      return direct;
    }

    const withoutOrigin = filePath.replace(/^[a-z]+:\/\/[^/]+/i, '');
    const marker = '/uploads/';
    const index = withoutOrigin.indexOf(marker);
    const relative =
      index === -1 ? withoutOrigin : withoutOrigin.slice(index + marker.length);

    if (!relative) {
      return null;
    }

    const target = resolve(root, decodeURIComponent(relative).replace(/^\/+/, ''));

    return target === root || target.startsWith(root + sep) ? target : null;
  }

  async uploadStream(
    stream: Readable,
    mimetype: string,
    ext: string
  ): Promise<UploadedStream> {
    try {
      if (!LOCAL_STORAGE_ALLOWED_MIME.has(mimetype)) {
        throw new Error('Unsupported file type.');
      }

      const { filename, filePath, path } = this.newFilePath(ext);
      try {
        await pipeline(stream, createWriteStream(filePath));
      } catch (err) {
        // Don't leave a truncated file behind (size cap hit, remote closed, ...)
        await this.removeFile(filePath).catch(() => {});
        throw err;
      }

      return {
        filename,
        path,
        mimetype,
        originalname: filename,
      };
    } catch (err) {
      console.error('Error streaming file to Local Storage:', err);
      throw err;
    }
  }

  // Accepts either the public URL or the filesystem path
  async removeFile(filePath: string): Promise<void> {
    const target = this.resolveLocalPath(filePath);
    if (!target) {
      return;
    }

    return new Promise((resolvePromise, reject) => {
      unlink(target, (err) => {
        // A file that is already gone is the desired end state, not an error.
        if (err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
          reject(err);
          return;
        }
        resolvePromise();
      });
    });
  }
}
