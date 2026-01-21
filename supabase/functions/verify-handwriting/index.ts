import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ==================== CONFIGURATION ====================
const VERIFICATION_THRESHOLDS = {
  VERIFIED: 80,        // >= 80: Verified (same writer)
  MANUAL_REVIEW: 50,   // 50-79: Manual Review required
  REUPLOAD: 0          // < 50: Reupload Required
};

const CRITICAL_FLAGS = [
  'typed', 'different writer', 'forgery', 'high risk',
  'not handwritten', 'computer generated', 'printed'
];

// Feature weights for weighted comparison
const FEATURE_WEIGHTS = {
  density: 0.05,
  strokeWidth: 0.12,
  strokeConsistency: 0.08,
  projectionH: 0.08,
  projectionV: 0.08,
  huMoments: 0.15,
  slantAngle: 0.06,
  loopCount: 0.05,
  edgeDensity: 0.05,
  curvature: 0.10,
  fourierDescriptors: 0.08,
  directionHistogram: 0.06,
  topology: 0.04
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB limit for processing

// ==================== IMAGE DATA INTERFACE ====================
interface ImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface HandwritingFeatures {
  density: number;
  aspectRatio: number;
  strokeWidth: number;
  strokeConsistency: number;
  huMoments: number[];
  horizontalProjection: number[];
  verticalProjection: number[];
  slantAngle: number;
  loopCount: number;
  endPoints: number;
  crossingPoints: number;
  edgeDensity: number;
  curvature: number[];
  fourierDescriptors: number[];
  directionHistogram: number[];
  topology: number;
}

interface SimpleFeatures {
  slant_angle: number;
  stroke_width: number;
  letter_height_ratio: number;
  inter_letter_spacing: number;
  inter_word_spacing: number;
  baseline_stability: number;
  letter_roundness: number;
  connection_style: number;
  pressure_variation: number;
  character_consistency: number;
}

// ==================== IMAGE PROCESSING ====================
class ImageProcessor {
  static toGrayscale(imageData: ImageData): ImageData {
    const result = { ...imageData, data: new Uint8ClampedArray(imageData.data) };
    
    for (let i = 0; i < result.data.length; i += 4) {
      const gray = Math.round(
        result.data[i] * 0.299 +
        result.data[i + 1] * 0.587 +
        result.data[i + 2] * 0.114
      );
      result.data[i] = result.data[i + 1] = result.data[i + 2] = gray;
    }
    
    return result;
  }

  static calculateOtsuThreshold(data: Uint8ClampedArray): number {
    const histogram = new Array(256).fill(0);
    
    for (let i = 0; i < data.length; i += 4) {
      histogram[data[i]]++;
    }
    
    const total = data.length / 4;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += i * histogram[i];
    }
    
    let sumB = 0, wB = 0, wF = 0, maxVariance = 0, threshold = 0;
    
    for (let i = 0; i < 256; i++) {
      wB += histogram[i];
      if (wB === 0) continue;
      
      wF = total - wB;
      if (wF === 0) break;
      
      sumB += i * histogram[i];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const variance = wB * wF * (mB - mF) * (mB - mF);
      
      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = i;
      }
    }
    
    return threshold;
  }

  static applyThreshold(imageData: ImageData): ImageData {
    const result = { ...imageData, data: new Uint8ClampedArray(imageData.data) };
    const threshold = this.calculateOtsuThreshold(result.data);
    
    for (let i = 0; i < result.data.length; i += 4) {
      const value = result.data[i] < threshold ? 0 : 255;
      result.data[i] = result.data[i + 1] = result.data[i + 2] = value;
    }
    
    return result;
  }

  static morphologicalOperation(
    imageData: ImageData,
    operation: 'dilate' | 'erode',
    kernelSize: number = 2
  ): ImageData {
    const { data, width, height } = imageData;
    const result = new Uint8ClampedArray(data);
    
    for (let y = kernelSize; y < height - kernelSize; y++) {
      for (let x = kernelSize; x < width - kernelSize; x++) {
        let extremeVal = operation === 'dilate' ? 255 : 0;
        
        for (let ky = -kernelSize; ky <= kernelSize; ky++) {
          for (let kx = -kernelSize; kx <= kernelSize; kx++) {
            const i = ((y + ky) * width + (x + kx)) * 4;
            if (operation === 'dilate') {
              extremeVal = Math.min(extremeVal, data[i]);
            } else {
              extremeVal = Math.max(extremeVal, data[i]);
            }
          }
        }
        
        const i = (y * width + x) * 4;
        result[i] = result[i + 1] = result[i + 2] = extremeVal;
      }
    }
    
    return { data: result, width, height };
  }

  static preprocess(imageData: ImageData): ImageData {
    let processed = this.toGrayscale(imageData);
    processed = this.applyThreshold(processed);
    processed = this.morphologicalOperation(processed, 'dilate', 2);
    processed = this.morphologicalOperation(processed, 'erode', 2);
    return processed;
  }
}

// ==================== FEATURE EXTRACTION ====================
class FeatureExtractor {
  static extractFeatures(imageData: ImageData): HandwritingFeatures {
    const { data, width, height } = imageData;
    const pixelMap: number[][] = [];
    let blackPixels = 0;
    
    for (let y = 0; y < height; y++) {
      pixelMap[y] = [];
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        pixelMap[y][x] = data[i] < 128 ? 1 : 0;
        if (pixelMap[y][x] === 1) blackPixels++;
      }
    }
    
    const density = blackPixels / (width * height);
    const aspectRatio = width / height;
    
    const moments = this.calculateMoments(pixelMap, width, height);
    const huMoments = this.calculateHuMoments(moments);
    const projections = this.calculateProjections(pixelMap, width, height);
    const strokeFeatures = this.calculateStrokeFeatures(pixelMap, width, height);
    const geometricFeatures = this.calculateGeometricFeatures(pixelMap, width, height, moments);
    const edgeFeatures = this.calculateEdgeFeatures(pixelMap, width, height);
    const advancedFeatures = this.calculateAdvancedFeatures(pixelMap, width, height);
    
    return {
      density,
      aspectRatio,
      strokeWidth: strokeFeatures.avgStrokeWidth,
      strokeConsistency: strokeFeatures.strokeConsistency,
      huMoments,
      horizontalProjection: projections.horizontal,
      verticalProjection: projections.vertical,
      slantAngle: geometricFeatures.slantAngle,
      loopCount: geometricFeatures.loopCount,
      endPoints: geometricFeatures.endPoints,
      crossingPoints: geometricFeatures.crossingPoints,
      edgeDensity: edgeFeatures.edgeDensity,
      curvature: advancedFeatures.curvature,
      fourierDescriptors: advancedFeatures.fourierDescriptors,
      directionHistogram: advancedFeatures.directionHistogram,
      topology: geometricFeatures.topology
    };
  }

  private static calculateMoments(pixelMap: number[][], width: number, height: number) {
    const moments = {
      m00: 0, m10: 0, m01: 0, m11: 0,
      m20: 0, m02: 0, m30: 0, m03: 0,
      m21: 0, m12: 0
    };
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixelMap[y][x]) {
          moments.m00++;
          moments.m10 += x;
          moments.m01 += y;
          moments.m11 += x * y;
          moments.m20 += x * x;
          moments.m02 += y * y;
          moments.m30 += x * x * x;
          moments.m03 += y * y * y;
          moments.m21 += x * x * y;
          moments.m12 += x * y * y;
        }
      }
    }
    
    return moments;
  }

  private static calculateHuMoments(moments: any): number[] {
    if (moments.m00 === 0) return [0, 0, 0, 0, 0, 0, 0];
    
    const xc = moments.m10 / moments.m00;
    const yc = moments.m01 / moments.m00;
    
    let mu20 = 0, mu02 = 0, mu11 = 0;
    let mu30 = 0, mu03 = 0, mu21 = 0, mu12 = 0;
    
    const eta20 = mu20 / Math.pow(moments.m00, 2);
    const eta02 = mu02 / Math.pow(moments.m00, 2);
    const eta11 = mu11 / Math.pow(moments.m00, 2);
    const eta30 = mu30 / Math.pow(moments.m00, 2.5);
    const eta03 = mu03 / Math.pow(moments.m00, 2.5);
    const eta21 = mu21 / Math.pow(moments.m00, 2.5);
    const eta12 = mu12 / Math.pow(moments.m00, 2.5);
    
    const h1 = eta20 + eta02;
    const h2 = Math.pow(eta20 - eta02, 2) + 4 * Math.pow(eta11, 2);
    const h3 = Math.pow(eta30 - 3 * eta12, 2) + Math.pow(3 * eta21 - eta03, 2);
    const h4 = Math.pow(eta30 + eta12, 2) + Math.pow(eta21 + eta03, 2);
    
    return [h1, h2, h3, h4, 0, 0, 0];
  }

  private static calculateProjections(pixelMap: number[][], width: number, height: number) {
    const horizontal = new Array(height).fill(0);
    const vertical = new Array(width).fill(0);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixelMap[y][x]) {
          horizontal[y]++;
          vertical[x]++;
        }
      }
    }
    
    return { horizontal, vertical };
  }

  private static calculateStrokeFeatures(pixelMap: number[][], width: number, height: number) {
    const strokeWidths: number[] = [];
    
    for (let y = 0; y < height; y++) {
      let runLength = 0;
      for (let x = 0; x < width; x++) {
        if (pixelMap[y][x]) {
          runLength++;
        } else if (runLength > 0) {
          strokeWidths.push(runLength);
          runLength = 0;
        }
      }
    }
    
    if (strokeWidths.length === 0) {
      return { avgStrokeWidth: 0, strokeConsistency: 0 };
    }
    
    const avgStrokeWidth = strokeWidths.reduce((a, b) => a + b, 0) / strokeWidths.length;
    let variance = 0;
    for (const w of strokeWidths) {
      variance += Math.pow(w - avgStrokeWidth, 2);
    }
    const strokeConsistency = Math.sqrt(variance / strokeWidths.length);
    
    return { avgStrokeWidth, strokeConsistency };
  }

  private static calculateGeometricFeatures(
    pixelMap: number[][],
    width: number,
    height: number,
    moments: any
  ) {
    let endPoints = 0;
    let crossingPoints = 0;
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (pixelMap[y][x]) {
          const neighbors =
            pixelMap[y - 1][x - 1] + pixelMap[y - 1][x] + pixelMap[y - 1][x + 1] +
            pixelMap[y][x - 1] + pixelMap[y][x + 1] +
            pixelMap[y + 1][x - 1] + pixelMap[y + 1][x] + pixelMap[y + 1][x + 1];
          
          if (neighbors === 1) endPoints++;
          else if (neighbors >= 3) crossingPoints++;
        }
      }
    }
    
    const loopCount = Math.max(0, crossingPoints - endPoints / 2);
    const topology = endPoints + crossingPoints;
    
    const xc = moments.m00 > 0 ? moments.m10 / moments.m00 : 0;
    const yc = moments.m00 > 0 ? moments.m01 / moments.m00 : 0;
    let mu11 = 0, mu20 = 0, mu02 = 0;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixelMap[y][x]) {
          const dx = x - xc;
          const dy = y - yc;
          mu11 += dx * dy;
          mu20 += dx * dx;
          mu02 += dy * dy;
        }
      }
    }
    
    const slantAngle = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
    
    return { slantAngle, loopCount, endPoints, crossingPoints, topology };
  }

  private static calculateEdgeFeatures(pixelMap: number[][], width: number, height: number) {
    let edgeCount = 0;
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const gx =
          -pixelMap[y - 1][x - 1] + pixelMap[y - 1][x + 1] +
          -2 * pixelMap[y][x - 1] + 2 * pixelMap[y][x + 1] +
          -pixelMap[y + 1][x - 1] + pixelMap[y + 1][x + 1];
        
        const gy =
          -pixelMap[y - 1][x - 1] - 2 * pixelMap[y - 1][x] - pixelMap[y - 1][x + 1] +
          pixelMap[y + 1][x - 1] + 2 * pixelMap[y + 1][x] + pixelMap[y + 1][x + 1];
        
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        if (magnitude > 0.5) edgeCount++;
      }
    }
    
    return { edgeDensity: edgeCount / (width * height) };
  }

  private static calculateAdvancedFeatures(pixelMap: number[][], width: number, height: number) {
    const contourPoints: { x: number; y: number }[] = [];
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixelMap[y][x]) {
          const hasWhiteNeighbor =
            (x > 0 && !pixelMap[y][x - 1]) ||
            (x < width - 1 && !pixelMap[y][x + 1]) ||
            (y > 0 && !pixelMap[y - 1][x]) ||
            (y < height - 1 && !pixelMap[y + 1][x]);
          
          if (hasWhiteNeighbor) {
            contourPoints.push({ x, y });
          }
        }
      }
    }
    
    const curvature: number[] = [];
    for (let i = 5; i < contourPoints.length - 5; i += 10) {
      const p1 = contourPoints[i - 5];
      const p2 = contourPoints[i];
      const p3 = contourPoints[i + 5];
      
      const v1 = { x: p2.x - p1.x, y: p2.y - p1.y };
      const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
      
      const angle = Math.atan2(v2.y, v2.x) - Math.atan2(v1.y, v1.x);
      curvature.push(angle);
    }
    
    const numDescriptors = Math.min(10, contourPoints.length);
    const fourierDescriptors: number[] = [];
    
    for (let k = 0; k < numDescriptors; k++) {
      let real = 0, imag = 0;
      for (let n = 0; n < Math.min(100, contourPoints.length); n++) {
        const angle = -2 * Math.PI * k * n / contourPoints.length;
        real += contourPoints[n].x * Math.cos(angle);
        imag += contourPoints[n].x * Math.sin(angle);
      }
      fourierDescriptors.push(Math.sqrt(real * real + imag * imag));
    }
    
    const directionHistogram = new Array(8).fill(0);
    for (let i = 1; i < contourPoints.length; i++) {
      const dx = contourPoints[i].x - contourPoints[i - 1].x;
      const dy = contourPoints[i].y - contourPoints[i - 1].y;
      const angle = Math.atan2(dy, dx);
      const bin = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 8) % 8;
      directionHistogram[bin]++;
    }
    
    return { curvature, fourierDescriptors, directionHistogram };
  }
}

// ==================== FEATURE COMPARISON ====================
class FeatureComparator {
  static compareFeatures(ref: HandwritingFeatures, ver: HandwritingFeatures): {
    scores: Record<string, number>;
    finalScore: number;
  } {
    const scores: Record<string, number> = {};
    
    // Density comparison
    const densityDiff = Math.abs(ref.density - ver.density);
    scores.density = Math.max(0, 100 - densityDiff * 500);
    
    // Stroke width
    const strokeDiff = Math.abs(ref.strokeWidth - ver.strokeWidth);
    scores.strokeWidth = Math.max(0, 100 - strokeDiff * 5);
    
    // Stroke consistency
    const consistencyDiff = Math.abs(ref.strokeConsistency - ver.strokeConsistency);
    scores.strokeConsistency = Math.max(0, 100 - consistencyDiff * 10);
    
    // Projection correlation
    scores.projectionH = this.calculateCorrelation(ref.horizontalProjection, ver.horizontalProjection) * 100;
    scores.projectionV = this.calculateCorrelation(ref.verticalProjection, ver.verticalProjection) * 100;
    
    // Hu moments
    let huScore = 0;
    for (let i = 0; i < Math.min(ref.huMoments.length, ver.huMoments.length); i++) {
      const diff = Math.abs(
        Math.log(Math.abs(ref.huMoments[i]) + 1e-10) -
        Math.log(Math.abs(ver.huMoments[i]) + 1e-10)
      );
      huScore += Math.max(0, 1 - diff / 5);
    }
    scores.huMoments = (huScore / Math.min(ref.huMoments.length, ver.huMoments.length)) * 100;
    
    // Slant angle
    const slantDiff = Math.abs(ref.slantAngle - ver.slantAngle);
    scores.slantAngle = Math.max(0, 100 - (slantDiff * 180 / Math.PI) * 5);
    
    // Loop count
    const loopDiff = Math.abs(ref.loopCount - ver.loopCount);
    scores.loopCount = Math.max(0, 100 - loopDiff * 20);
    
    // Edge density
    const edgeDiff = Math.abs(ref.edgeDensity - ver.edgeDensity);
    scores.edgeDensity = Math.max(0, 100 - edgeDiff * 1000);
    
    // Curvature
    scores.curvature = this.calculateCorrelation(ref.curvature, ver.curvature) * 100;
    
    // Fourier descriptors
    let fourierScore = 0;
    for (let i = 0; i < Math.min(ref.fourierDescriptors.length, ver.fourierDescriptors.length); i++) {
      const diff = Math.abs(ref.fourierDescriptors[i] - ver.fourierDescriptors[i]);
      fourierScore += Math.max(0, 1 - diff / 100);
    }
    scores.fourierDescriptors = (fourierScore / Math.max(1, Math.min(ref.fourierDescriptors.length, ver.fourierDescriptors.length))) * 100;
    
    // Direction histogram
    scores.directionHistogram = this.calculateCorrelation(ref.directionHistogram, ver.directionHistogram) * 100;
    
    // Topology
    const topologyDiff = Math.abs(ref.topology - ver.topology);
    scores.topology = Math.max(0, 100 - topologyDiff * 2);
    
    // Calculate weighted final score
    let finalScore = 0;
    for (const [key, score] of Object.entries(scores)) {
      const weight = FEATURE_WEIGHTS[key as keyof typeof FEATURE_WEIGHTS] || 0;
      finalScore += (score || 0) * weight;
    }
    
    return {
      scores,
      finalScore: Math.max(0, Math.min(100, Math.round(finalScore * 100) / 100))
    };
  }

  private static calculateCorrelation(arr1: number[], arr2: number[]): number {
    const len = Math.min(arr1.length, arr2.length);
    if (len === 0) return 0;
    
    const mean1 = arr1.slice(0, len).reduce((a, b) => a + b, 0) / len;
    const mean2 = arr2.slice(0, len).reduce((a, b) => a + b, 0) / len;
    
    let num = 0, den1 = 0, den2 = 0;
    for (let i = 0; i < len; i++) {
      const diff1 = arr1[i] - mean1;
      const diff2 = arr2[i] - mean2;
      num += diff1 * diff2;
      den1 += diff1 * diff1;
      den2 += diff2 * diff2;
    }
    
    return den1 === 0 || den2 === 0 ? 0 : Math.max(0, num / Math.sqrt(den1 * den2));
  }
}

// ==================== SIMPLE FEATURE COMPARISON ====================
function compareSimpleFeatures(ref: SimpleFeatures, ver: SimpleFeatures): number {
  const thresholds: Record<string, number> = {
    slant_angle: 10,
    stroke_width: 2,
    letter_height_ratio: 0.15,
    inter_letter_spacing: 2,
    inter_word_spacing: 2,
    baseline_stability: 2,
    letter_roundness: 2,
    connection_style: 20,
    pressure_variation: 2,
    character_consistency: 2,
  };

  const ranges: Record<string, [number, number]> = {
    slant_angle: [-45, 45],
    stroke_width: [1, 10],
    letter_height_ratio: [0.3, 0.9],
    inter_letter_spacing: [1, 10],
    inter_word_spacing: [1, 10],
    baseline_stability: [1, 10],
    letter_roundness: [1, 10],
    connection_style: [0, 100],
    pressure_variation: [1, 10],
    character_consistency: [1, 10],
  };

  let totalScore = 0;
  let count = 0;

  for (const key of Object.keys(ref) as (keyof SimpleFeatures)[]) {
    const refVal = ref[key];
    const verVal = ver[key];
    const diff = Math.abs(refVal - verVal);
    const threshold = thresholds[key] || 2;
    const [min, max] = ranges[key] || [0, 10];
    const range = max - min;
    
    // Score based on how close the values are (0-100)
    const normalizedDiff = diff / range;
    const score = Math.max(0, 100 - normalizedDiff * 100);
    totalScore += score;
    count++;
  }

  return count > 0 ? totalScore / count : 0;
}

// ==================== FILE UTILITIES ====================
async function fetchFileAsBase64(url: string, supabase?: any): Promise<string> {
  console.log('Fetching file:', url);

  if (url.includes('/storage/v1/object/public/uploads/') && supabase) {
    const pathMatch = url.match(/\/uploads\/(.+)$/);
    if (pathMatch) {
      const filePath = pathMatch[1];
      console.log('Downloading from private bucket, path:', filePath);

      const { data, error } = await supabase.storage
        .from('uploads')
        .download(filePath);

      if (error) {
        console.error('Storage download error:', error);
        throw new Error(`Failed to download from storage: ${error.message}`);
      }

      const arrayBuffer = await data.arrayBuffer();
      
      if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
        console.log(`File too large (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB), truncating`);
        const truncated = arrayBuffer.slice(0, MAX_FILE_SIZE);
        return encode(truncated);
      }
      
      return encode(arrayBuffer);
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  
  if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
    console.log(`File too large (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB), truncating`);
    const truncated = arrayBuffer.slice(0, MAX_FILE_SIZE);
    return encode(truncated);
  }
  
  return encode(arrayBuffer);
}

function getMimeType(url: string, fileType?: string): string {
  if (fileType) {
    if (fileType.includes('pdf')) return 'application/pdf';
    if (fileType.includes('image')) return fileType;
    if (fileType.includes('doc')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  
  const ext = url.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'doc': return 'application/msword';
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default: return 'application/octet-stream';
  }
}

function hasCriticalFlags(flaggedConcerns: string[]): boolean {
  if (!flaggedConcerns || flaggedConcerns.length === 0) return false;
  const concernsLower = flaggedConcerns.map(c => c.toLowerCase()).join(' ');
  return CRITICAL_FLAGS.some(flag => concernsLower.includes(flag));
}

// ==================== MAIN HANDLER ====================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let submission_id: string | undefined;

  try {
    const body = await req.json();
    submission_id = body.submission_id;
    const file_url = body.file_url;
    const file_type = body.file_type;
    const student_profile_id = body.student_profile_id;
    
    console.log('=== HANDWRITING VERIFICATION START ===');
    console.log('Submission:', submission_id);
    console.log('File URL:', file_url);
    console.log('Student Profile ID:', student_profile_id);

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    if (!submission_id || !file_url || !student_profile_id) {
      throw new Error('Missing required parameters');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check if already processed
    const { data: existing } = await supabase
      .from('submissions')
      .select('ai_risk_level, verified_at')
      .eq('id', submission_id)
      .single();

    if (existing?.ai_risk_level && 
        existing.ai_risk_level !== 'pending' && 
        existing.verified_at) {
      console.log('Already processed:', existing.ai_risk_level);
      return new Response(JSON.stringify({ 
        status: 'already_processed',
        risk_level: existing.ai_risk_level
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check file size
    try {
      const headResponse = await fetch(file_url, { method: 'HEAD' });
      const contentLength = headResponse.headers.get('content-length');
      
      if (contentLength && parseInt(contentLength, 10) > 8 * 1024 * 1024) {
        console.log('File too large for verification');
        
        await supabase
          .from('submissions')
          .update({
            ai_risk_level: 'medium',
            ai_analysis_details: { 
              error: 'File too large for automatic verification (>8MB)',
              needs_manual_review: true 
            },
            verified_at: new Date().toISOString(),
          })
          .eq('id', submission_id);
        
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'File too large. Marked for manual review.' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } catch (headErr) {
      console.log('HEAD request failed, continuing:', headErr);
    }

    // Mark as pending
    await supabase
      .from('submissions')
      .update({
        ai_risk_level: 'pending',
        verified_at: null,
        ai_similarity_score: null,
        ai_confidence_score: null,
        ai_flagged_sections: null,
        ai_analysis_details: null,
      })
      .eq('id', submission_id);

    // Fetch student reference handwriting
    const { data: studentDetails, error: studentError } = await supabase
      .from('student_details')
      .select('handwriting_url, handwriting_feature_embedding, profile_id')
      .eq('profile_id', student_profile_id)
      .single();

    if (studentError) {
      console.error('Student details error:', studentError);
      throw new Error('Failed to fetch student details');
    }

    if (!studentDetails?.handwriting_url) {
      console.log('No handwriting sample found');
      await supabase
        .from('submissions')
        .update({
          ai_risk_level: 'medium',
          ai_analysis_details: { error: 'No handwriting sample uploaded by student' },
          verified_at: new Date().toISOString(),
        })
        .eq('id', submission_id);
      
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'No handwriting sample found' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const referenceFeatures = studentDetails.handwriting_feature_embedding as SimpleFeatures | null;
    console.log('Reference features available:', !!referenceFeatures);

    // Check submission file type - PDFs/DOCs can't be visually analyzed by AI
    const submissionMimeType = getMimeType(file_url, file_type);
    console.log('Submission MIME:', submissionMimeType);

    // For PDFs and DOCs, mark for manual review since AI can't process them
    if (submissionMimeType === 'application/pdf' || 
        submissionMimeType.includes('msword') || 
        submissionMimeType.includes('wordprocessing')) {
      console.log('Document file detected - marking for manual review');
      
      await supabase
        .from('submissions')
        .update({
          ai_risk_level: 'medium',
          ai_analysis_details: { 
            note: 'Document file requires manual verification. AI can only analyze images.',
            file_type: submissionMimeType,
            needs_manual_review: true 
          },
          verified_at: new Date().toISOString(),
        })
        .eq('id', submission_id);
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Document marked for manual review (PDF/DOC files require faculty verification)',
        risk_level: 'medium'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch both image files for AI verification
    const [referenceBase64, submissionBase64] = await Promise.all([
      fetchFileAsBase64(studentDetails.handwriting_url, supabase),
      fetchFileAsBase64(file_url, supabase),
    ]);

    const referenceMimeType = getMimeType(studentDetails.handwriting_url);
    console.log('Reference MIME:', referenceMimeType);

    // Build AI prompt for visual analysis
    const analysisPrompt = `You are an expert forensic document examiner specializing in handwriting analysis.

## TASK
Compare the REFERENCE handwriting sample (Image 1) against the ASSIGNMENT submission (Image 2) to determine if they were written by the SAME PERSON.

## ANALYSIS AREAS
1. **Letter Formation**: How specific letters are constructed
2. **Slant Angle**: Overall slant direction and consistency
3. **Spacing**: Between letters and words
4. **Baseline**: How straight/wavy the writing line is
5. **Unique Features**: Personal quirks, i-dots, t-crosses

## CRITICAL FLAGS
- Assignment is TYPED = similarity < 20
- Completely different handwriting = similarity < 50
- Clear forgery attempt = similarity < 30

## SCORING RULES
- **80-100**: Verified (same writer with high confidence)
- **50-79**: Manual review required (some differences detected)
- **0-49**: Reupload required (likely different writer or typed)

## OUTPUT FORMAT
Respond with ONLY this JSON:
{
  "submission_features": {
    "slant_angle": <-45 to +45>,
    "stroke_width": <1-10>,
    "letter_height_ratio": <0.3-0.9>,
    "inter_letter_spacing": <1-10>,
    "inter_word_spacing": <1-10>,
    "baseline_stability": <1-10>,
    "letter_roundness": <1-10>,
    "connection_style": <0-100>,
    "pressure_variation": <1-10>,
    "character_consistency": <1-10>
  },
  "similarity_score": <0-100>,
  "confidence_score": <0-100>,
  "risk_level": "low" | "medium" | "high",
  "analysis_details": {
    "letter_formation": { "match": <true/false>, "notes": "<observation>" },
    "slant_angle": { "match": <true/false>, "notes": "<observation>" },
    "spacing": { "match": <true/false>, "notes": "<observation>" },
    "baseline": { "match": <true/false>, "notes": "<observation>" },
    "unique_features": { "match": <true/false>, "notes": "<observation>" }
  },
  "overall_conclusion": "<2-3 sentence assessment>",
  "flagged_concerns": ["<concern 1>", "<concern 2>"]
}

BE STRICT. Academic integrity depends on accurate analysis.`;

    // Build content with both images
    const content: any[] = [
      { type: 'text', text: analysisPrompt },
      {
        type: 'image_url',
        image_url: { url: `data:${referenceMimeType};base64,${referenceBase64}` }
      },
      {
        type: 'image_url',
        image_url: { url: `data:${submissionMimeType};base64,${submissionBase64}` }
      }
    ];

    console.log('Calling Lovable AI...');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content }],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI Gateway error:', aiResponse.status, errorText);
      throw new Error(`AI analysis failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const responseText = aiData.choices?.[0]?.message?.content || '';
    console.log('AI response received, length:', responseText.length);

    // Parse AI response
    let aiResult: any;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found');
      }
      aiResult = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Parse error:', parseError);
      // Fallback to manual review
      await supabase
        .from('submissions')
        .update({
          ai_risk_level: 'medium',
          ai_analysis_details: { 
            error: 'Failed to parse AI response',
            raw_response: responseText.substring(0, 500)
          },
          verified_at: new Date().toISOString(),
        })
        .eq('id', submission_id);
      
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'AI response parsing failed. Marked for manual review.' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract scores from AI
    let aiSimilarity = aiResult.similarity_score || 50;
    let aiConfidence = aiResult.confidence_score || 50;
    const flaggedConcerns = aiResult.flagged_concerns || [];

    console.log('AI Similarity:', aiSimilarity);
    console.log('AI Confidence:', aiConfidence);
    console.log('Flagged concerns:', flaggedConcerns);

    // If we have reference features AND submission features from AI, do computational comparison
    let computedScore: number | null = null;
    if (referenceFeatures && aiResult.submission_features) {
      try {
        computedScore = compareSimpleFeatures(referenceFeatures, aiResult.submission_features);
        console.log('Computed feature score:', computedScore);
      } catch (e) {
        console.log('Feature comparison failed:', e);
      }
    }

    // Combine scores: average AI and computed if both available
    let finalSimilarity = aiSimilarity;
    if (computedScore !== null) {
      finalSimilarity = Math.round((aiSimilarity + computedScore) / 2);
      console.log('Combined score:', finalSimilarity);
    }

    // Check for critical flags - auto-demote to high risk
    const criticalFlagsDetected = hasCriticalFlags(flaggedConcerns);
    if (criticalFlagsDetected) {
      console.log('Critical flags detected! Demoting to high risk.');
      finalSimilarity = Math.min(finalSimilarity, 45);
    }

    // Determine risk level based on thresholds
    let riskLevel: 'low' | 'medium' | 'high';
    if (finalSimilarity >= VERIFICATION_THRESHOLDS.VERIFIED) {
      riskLevel = 'low';        // Verified
    } else if (finalSimilarity >= VERIFICATION_THRESHOLDS.MANUAL_REVIEW) {
      riskLevel = 'medium';     // Manual Review
    } else {
      riskLevel = 'high';       // Reupload Required
    }

    console.log('Final similarity:', finalSimilarity);
    console.log('Risk level:', riskLevel);

    // Prepare analysis details
    const analysisDetails = {
      ...aiResult.analysis_details,
      submission_features: aiResult.submission_features,
      ai_similarity: aiSimilarity,
      computed_similarity: computedScore,
      final_similarity: finalSimilarity,
      critical_flags_detected: criticalFlagsDetected,
      overall_conclusion: aiResult.overall_conclusion,
      algorithm_version: '2.0-hybrid',
      processed_at: new Date().toISOString()
    };

    // Update submission
    const { error: updateError } = await supabase
      .from('submissions')
      .update({
        ai_similarity_score: finalSimilarity,
        ai_confidence_score: aiConfidence,
        ai_risk_level: riskLevel,
        ai_flagged_sections: flaggedConcerns.length > 0 ? flaggedConcerns : null,
        ai_analysis_details: analysisDetails,
        verified_at: new Date().toISOString(),
      })
      .eq('id', submission_id);

    if (updateError) {
      console.error('Update error:', updateError);
      throw new Error('Failed to update submission');
    }

    console.log('=== VERIFICATION COMPLETE ===');
    console.log('Score:', finalSimilarity, '- Risk:', riskLevel);

    // Send notification if medium/high risk
    if (riskLevel === 'medium' || riskLevel === 'high') {
      try {
        await supabase.functions.invoke('send-notification', {
          body: {
            type: 'submission_flagged',
            submission_id,
            risk_level: riskLevel,
            similarity_score: finalSimilarity,
          },
        });
      } catch (notifyErr) {
        console.log('Notification failed:', notifyErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      similarity_score: finalSimilarity,
      confidence_score: aiConfidence,
      risk_level: riskLevel,
      flagged_concerns: flaggedConcerns,
      analysis_details: analysisDetails,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Verification error:', error);
    
    // Try to mark as needing manual review on error
    if (submission_id) {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        await supabase
          .from('submissions')
          .update({
            ai_risk_level: 'medium',
            ai_analysis_details: { 
              error: error instanceof Error ? error.message : 'Unknown error',
              needs_manual_review: true
            },
            verified_at: new Date().toISOString(),
          })
          .eq('id', submission_id);
      } catch (e) {
        console.error('Failed to mark as needs review:', e);
      }
    }
    
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
