export type QualityFailureCode = 'tiny' | 'blur' | 'dark' | 'overexposed' | 'page_boundary' | 'tilted' | 'occluded' | 'blank';

export interface ImageQualityResult {
  ok: boolean;
  metrics: Record<string, number>;
  failures: Array<{ code: QualityFailureCode; message: string }>;
}

const messages: Record<QualityFailureCode, string> = {
  tiny: 'Move closer so the page is at least 1000 pixels on its short side.',
  blur: 'The image is blurry. Hold the phone steady and recapture.',
  dark: 'The page is too dark. Use brighter, even lighting without shadows.',
  overexposed: 'The page is overexposed. Reduce glare and avoid direct flash.',
  page_boundary: 'Keep the entire page inside the frame with a visible border.',
  tilted: 'Straighten the page and align it with the on-screen frame.',
  occluded: 'Remove fingers, objects, or heavy shadows covering the page.',
  blank: 'No sufficient ink was detected. Make sure the page contains handwriting.',
};

const variance = (values: number[], mean: number) => values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(values.length, 1);

export async function analyzeImageQuality(file: Blob): Promise<ImageQualityResult> {
  const bitmap = await createImageBitmap(file);
  const shortSide = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser cannot inspect the captured image.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const gray: number[] = [];
  let dark = 0;
  let bright = 0;
  let skinTone = 0;
  const darkPoints: Array<[number, number]> = [];
  for (let i = 0; i < pixels.length; i += 4) {
    const value = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    gray.push(value);
    if (value < 45) dark++;
    if (value > 248) bright++;
    const pixel = i / 4;
    const x = pixel % canvas.width;
    const y = Math.floor(pixel / canvas.width);
    if (value < 45) darkPoints.push([x, y]);
    if (pixels[i] > pixels[i + 1] * 1.15 && pixels[i + 1] > pixels[i + 2] * 1.1 && pixels[i] > 70 && pixels[i] < 245) skinTone++;
  }
  const mean = gray.reduce((sum, value) => sum + value, 0) / gray.length;
  const laplacian: number[] = [];
  const width = canvas.width;
  for (let y = 1; y < canvas.height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const index = y * width + x;
    laplacian.push(4 * gray[index] - gray[index - 1] - gray[index + 1] - gray[index - width] - gray[index + width]);
  }
  const edge = (x: number, y: number) => Math.abs(4 * gray[y * width + x] - gray[y * width + x - 1] - gray[y * width + x + 1] - gray[(y - 1) * width + x] - gray[(y + 1) * width + x]);
  const border = Array.from({ length: width }, (_, x) => edge(Math.max(1, x), 1))
    .concat(Array.from({ length: width }, (_, x) => edge(Math.max(1, x), canvas.height - 2)))
    .concat(Array.from({ length: canvas.height }, (_, y) => edge(1, Math.max(1, y))))
    .concat(Array.from({ length: canvas.height }, (_, y) => edge(width - 2, Math.max(1, y))));
  const centre: number[] = [];
  for (let y = Math.floor(canvas.height * 0.25); y < Math.ceil(canvas.height * 0.75); y++) {
    for (let x = Math.floor(width * 0.25); x < Math.ceil(width * 0.75); x++) centre.push(gray[y * width + x]);
  }
  const meanX = darkPoints.reduce((sum, point) => sum + point[0], 0) / Math.max(darkPoints.length, 1);
  const meanY = darkPoints.reduce((sum, point) => sum + point[1], 0) / Math.max(darkPoints.length, 1);
  const covariance = darkPoints.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
  const varianceX = darkPoints.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
  const tiltAngle = Math.atan2(covariance, varianceX || 1) * 180 / Math.PI;
  const metrics = {
    width: bitmap.width, height: bitmap.height, short_side: shortSide, brightness: mean,
    overexposure: bright / gray.length, dark_coverage: dark / gray.length,
    blur_variance: variance(laplacian, laplacian.reduce((sum, value) => sum + value, 0) / Math.max(laplacian.length, 1)),
    border_edge_density: border.filter((value) => value > 35).length / Math.max(border.length, 1),
    centre_edge_density: centre.filter((value, index) => index > 0 && Math.abs(value - centre[index - 1]) > 35).length / Math.max(centre.length, 1),
    tilt_angle: tiltAngle,
    skin_tone_coverage: skinTone / gray.length,
  };
  const codes: QualityFailureCode[] = [];
  if (shortSide < 1000) codes.push('tiny');
  if (metrics.blur_variance < 80) codes.push('blur');
  if (mean < 55) codes.push('dark');
  if (metrics.overexposure > 0.35) codes.push('overexposed');
  if (metrics.border_edge_density < metrics.centre_edge_density * 0.35) codes.push('page_boundary');
  if (Math.abs(metrics.tilt_angle) > 12) codes.push('tilted');
  if (metrics.skin_tone_coverage > 0.2 || metrics.dark_coverage > 0.45) codes.push('occluded');
  if (metrics.dark_coverage < 0.002) codes.push('blank');
  return { ok: codes.length === 0, metrics, failures: codes.map((code) => ({ code, message: messages[code] })) };
}

export async function createAiImageCopy(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare the captured image.');
  context.filter = 'grayscale(1) contrast(1.15)'; context.drawImage(bitmap, 0, 0); bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare the image.')), 'image/jpeg', 0.92));
}