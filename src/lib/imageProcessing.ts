/**
 * Shared mobile-safe image pipeline.
 *
 * Mobile browsers break image handling in several distinct ways, and each step
 * below exists to defeat a specific one:
 *  - Android Chrome's Google Photos picker returns lazy `content://` File
 *    handles that are revoked before submit runs, so bytes are snapshotted at
 *    selection time.
 *  - iPhones hand over HEIC/HEIF, which Chrome (and older Safari) cannot decode
 *    on a canvas, so those are transcoded to JPEG first.
 *  - Some pickers supply an empty/incorrect MIME type, so the format is sniffed
 *    from the file's magic bytes instead of trusting `file.type`.
 *  - Very large camera images (50MP+) can exhaust canvas memory, so decoding
 *    downscales progressively instead of failing outright.
 */

export const MAX_IMAGE_DIMENSION = 1920;

/** Upper bound on the ORIGINAL file. Normalization compresses well below this. */
export const MAX_SOURCE_FILE_SIZE = 30 * 1024 * 1024; // 30MB

const SUPPORTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
const SUPPORTED_MIME = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

export const getExtension = (name: string): string =>
  (name.split('.').pop() ?? '').toLowerCase();

/**
 * Sniff the real image format from magic bytes. Mobile pickers frequently send
 * an empty or wrong `file.type`, so the bytes are the only reliable source.
 */
export const sniffImageType = (bytes: Uint8Array): string | null => {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png';
  // WEBP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  )
    return 'image/webp';
  // HEIC/HEIF: ....ftyp{heic|heix|hevc|mif1|msf1|heim|heis|hevm}
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevm', 'heim', 'heis', 'mif1', 'msf1'].includes(brand))
      return 'image/heic';
  }
  return null;
};

/** Validate an image before it is accepted into the upload list. */
export const validateImageFile = (file: File): string | null => {
  const ext = getExtension(file.name);
  const typeOk = SUPPORTED_MIME.includes((file.type || '').toLowerCase());
  const extOk = SUPPORTED_EXTENSIONS.includes(ext);

  // Mobile browsers often omit the MIME type entirely; accept on extension, and
  // when both are missing let the byte sniffer decide during processing.
  if (!typeOk && !extOk && file.type && !file.type.startsWith('image/')) {
    return `"${file.name}" is not a supported image. Use JPG, PNG, WEBP, or HEIC.`;
  }
  if (file.size === 0) {
    return `"${file.name}" is empty or could not be read from your device. Please reselect it.`;
  }
  if (file.size > MAX_SOURCE_FILE_SIZE) {
    return `"${file.name}" exceeds 30MB. Please pick a smaller image.`;
  }
  return null;
};

/**
 * Read the file's bytes into memory immediately. This is what keeps Android
 * gallery picks alive: once the bytes are copied, the OS handle can expire
 * without breaking the submission.
 */
export const materializeFile = async (file: File): Promise<Blob> => {
  const fallbackType = file.type || 'image/jpeg';
  try {
    const buf = await file.arrayBuffer();
    if (buf.byteLength === 0) throw new Error('empty read');
    const sniffed = sniffImageType(new Uint8Array(buf.slice(0, 16)));
    return new Blob([buf], { type: sniffed || fallbackType });
  } catch {
    try {
      return await new Promise<Blob>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as ArrayBuffer;
          if (!result || result.byteLength === 0) {
            reject(new Error(`Could not read "${file.name}" from your device.`));
            return;
          }
          const sniffed = sniffImageType(new Uint8Array(result.slice(0, 16)));
          resolve(new Blob([result], { type: sniffed || fallbackType }));
        };
        reader.onerror = () =>
          reject(new Error(`Could not read "${file.name}" from your device.`));
        reader.readAsArrayBuffer(file);
      });
    } catch {
      const tempUrl = URL.createObjectURL(file);
      try {
        const response = await fetch(tempUrl);
        if (!response.ok) throw new Error(`Could not access "${file.name}".`);
        const blob = await response.blob();
        return new Blob([blob], { type: blob.type || fallbackType });
      } finally {
        URL.revokeObjectURL(tempUrl);
      }
    }
  }
};

/** True when the blob is HEIC/HEIF and therefore undecodable on most canvases. */
const isHeicBlob = async (blob: Blob): Promise<boolean> => {
  const type = (blob.type || '').toLowerCase();
  if (type === 'image/heic' || type === 'image/heif') return true;
  try {
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    return sniffImageType(head) === 'image/heic';
  } catch {
    return false;
  }
};

/**
 * Transcode HEIC/HEIF to JPEG. The converter is imported on demand so the
 * (large) decoder never touches the bundle for desktop users.
 */
const convertHeicToJpeg = async (blob: Blob, fileName: string): Promise<Blob> => {
  try {
    const { default: heic2any } = await import('heic2any');
    const converted = await heic2any({ blob, toType: 'image/jpeg', quality: 0.9 });
    const out = Array.isArray(converted) ? converted[0] : converted;
    return new Blob([out as Blob], { type: 'image/jpeg' });
  } catch (e) {
    console.error('HEIC conversion failed', e);
    throw new Error(
      `"${fileName}" is an iPhone HEIC image that could not be converted. In your iPhone Settings, set Camera > Formats to "Most Compatible", or export the photo as JPG and upload again.`
    );
  }
};

type DecodedImage = {
  source: CanvasImageSource;
  w: number;
  h: number;
  cleanup: () => void;
};

const decodeBlob = async (blob: Blob, fileName: string): Promise<DecodedImage> => {
  if (typeof createImageBitmap === 'function') {
    try {
      let bitmap: ImageBitmap;
      try {
        // `from-image` applies EXIF orientation, so rotated phone photos are upright.
        bitmap = await createImageBitmap(blob, {
          imageOrientation: 'from-image',
        } as ImageBitmapOptions);
      } catch {
        bitmap = await createImageBitmap(blob);
      }
      return {
        source: bitmap,
        w: bitmap.width,
        h: bitmap.height,
        cleanup: () => bitmap.close?.(),
      };
    } catch (e) {
      console.warn('createImageBitmap failed, falling back to <img>', e);
    }
  }

  return new Promise<DecodedImage>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const imgEl = new window.Image();
    imgEl.decoding = 'async';
    imgEl.onload = () => {
      if (!imgEl.naturalWidth || !imgEl.naturalHeight) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`"${fileName}" appears to be corrupted and could not be opened.`));
        return;
      }
      resolve({
        source: imgEl,
        w: imgEl.naturalWidth,
        h: imgEl.naturalHeight,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      });
    };
    imgEl.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(
        new Error(
          `Could not read "${fileName}". The file may be corrupted or in an unsupported format.`
        )
      );
    };
    imgEl.src = objectUrl;
  });
};

/**
 * Draw to a canvas at a bounded size and encode as JPEG. Retries at smaller
 * scales because huge camera images can blow the canvas memory budget on
 * low-end phones, which surfaces as a null `toBlob` result.
 */
const resizeAndEncode = async (
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  quality: number,
  maxDimension: number
): Promise<Blob> => {
  let limit = maxDimension;

  for (let attempt = 0; attempt < 3; attempt++) {
    let w = srcW;
    let h = srcH;
    if (w > limit || h > limit) {
      if (w >= h) {
        h = Math.max(1, Math.round(h * (limit / w)));
        w = limit;
      } else {
        w = Math.max(1, Math.round(w * (limit / h)));
        h = limit;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser blocked image processing (canvas unavailable).');
    ctx.drawImage(source, 0, 0, w, h);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
    );
    canvas.width = 0;
    canvas.height = 0;

    if (blob && blob.size > 0) return blob;

    // Out of memory at this size — halve and retry.
    limit = Math.max(640, Math.round(limit / 2));
  }

  throw new Error('This image is too large for your device to process. Try a lower camera resolution.');
};

/**
 * Full pipeline: snapshot bytes -> convert HEIC if needed -> decode with EXIF
 * orientation -> downscale -> JPEG. Always returns a JPEG the AI pipeline and
 * storage can handle.
 */
export const normalizeImageFile = async (
  file: File,
  options: { quality?: number; maxDimension?: number } = {}
): Promise<Blob> => {
  const { quality = 0.85, maxDimension = MAX_IMAGE_DIMENSION } = options;

  let blob = await materializeFile(file);
  if (await isHeicBlob(blob)) {
    blob = await convertHeicToJpeg(blob, file.name);
  }

  const { source, w, h, cleanup } = await decodeBlob(blob, file.name);
  try {
    return await resizeAndEncode(source, w, h, quality, maxDimension);
  } finally {
    cleanup();
  }
};

/**
 * Snapshot a picked file into a stable in-memory File, converting HEIC so that
 * on-screen previews render too.
 */
export const snapshotFileForUpload = async (file: File): Promise<File> => {
  let blob = await materializeFile(file);
  let name = file.name || `page-${Date.now()}.jpg`;

  if (await isHeicBlob(blob)) {
    blob = await convertHeicToJpeg(blob, name);
    name = name.replace(/\.(heic|heif)$/i, '.jpg');
    if (!/\.jpe?g$/i.test(name)) name = `${name}.jpg`;
  }

  return new File([blob], name, {
    type: blob.type || 'image/jpeg',
    lastModified: Date.now(),
  });
};
