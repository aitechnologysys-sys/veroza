// Per-file upload limits, shared by the frontend checks and every backend upload path.
export const MAX_IMAGE_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_VIDEO_UPLOAD_SIZE = 1024 * 1024 * 1024; // 1 GB
// Largest limit of any type, for transport-level caps (multer, uppy) that run before the type is known.
export const MAX_UPLOAD_SIZE = MAX_VIDEO_UPLOAD_SIZE;
export const UPLOAD_SIZE_LIMITS_LABEL = '10 MB per image, 1 GB per video';

const isVideo = (mime?: string) => !!mime?.startsWith('video/');

export const maxUploadSizeFor = (mime?: string) =>
  isVideo(mime) ? MAX_VIDEO_UPLOAD_SIZE : MAX_IMAGE_UPLOAD_SIZE;

export const maxUploadSizeLabelFor = (mime?: string) =>
  isVideo(mime) ? '1 GB' : '10 MB';

export const isOverUploadLimit = (file: { size: number; type?: string }) =>
  file.size > maxUploadSizeFor(file.type);
