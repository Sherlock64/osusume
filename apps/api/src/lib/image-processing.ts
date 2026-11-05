import { type ImageSize, imageSizeEdges, imageSizes } from '@osusume/shared';
import sharp from 'sharp';
import { ApiError } from './errors.ts';

/** Everything is stored in this format, whatever was uploaded. */
export const STORED_IMAGE_MIME = 'image/webp';

/** Refuses decompression bombs: a small file that decodes to a huge image. */
const MAX_INPUT_PIXELS = 50_000_000;

const WEBP_QUALITY = 80;

export interface ProcessedImage {
  /** The `large` size's dimensions. */
  width: number;
  height: number;
  variants: Record<ImageSize, Uint8Array>;
  /** Full size in the uploaded format, with metadata stripped. Never served to users. */
  original: Uint8Array;
}

const unsupportedFormat = () =>
  new ApiError(415, 'unsupported_image_format', 'Upload a JPEG, PNG or WebP image.');
const invalidImage = () =>
  new ApiError(400, 'invalid_image', 'This file could not be read as an image.');

/** The format the file's own bytes declare, among those accepted. */
function sniffFormat(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Validates an upload by its content, ignoring the name and type it was declared with, and
 * resizes it. Only recognized bytes reach the decoder, so an SVG or anything else it could
 * parse never does. Everything kept is re-encoded, including the original, which drops metadata
 * such as EXIF location; orientation is applied first. An animated image keeps its first frame.
 */
export async function processImage(bytes: Uint8Array): Promise<ProcessedImage> {
  const format = sniffFormat(bytes);
  if (format === null) throw unsupportedFormat();

  try {
    const source = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS });
    const metadata = await source.metadata();
    if (metadata.format !== format) throw invalidImage();

    const encode = (size: ImageSize) =>
      source
        .clone()
        .rotate()
        .resize({
          width: imageSizeEdges[size],
          height: imageSizeEdges[size],
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });

    const upright = source.clone().rotate();
    const originalEncoding = {
      jpeg: () => upright.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }),
      png: () => upright.png(),
      webp: () => upright.webp({ quality: 95 }),
    }[format];

    const [[small, medium, large], original] = await Promise.all([
      Promise.all(imageSizes.map(encode)),
      originalEncoding().toBuffer(),
    ]);
    if (!small || !medium || !large) throw new Error('A size was not produced');
    return {
      width: large.info.width,
      height: large.info.height,
      variants: { small: small.data, medium: medium.data, large: large.data },
      original,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // sharp reports a corrupt, truncated or too large image only as an Error with a message.
    throw invalidImage();
  }
}
