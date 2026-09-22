/**
 * OpenCV.js Image Quality Validation and Conservative Preprocessing Engine.
 *
 * Implements:
 * 1. Asynchronous on-demand loading of browser-compatible OpenCV.js (WebAssembly/JS) with resilient fallback
 * 2. Laplacian-variance sharpness / blur detection using cv.Laplacian and variance thresholding
 * 3. Histogram analysis (cv.calcHist) and luminance stats for accurate brightness / exposure detection
 * 4. Contrast measurement (standard deviation of gray intensity)
 * 5. Quality validation returning a structured ImageQualityResult (`qualityPassed` boolean, metrics, warnings)
 * 6. Zero mutation of original canvas/image: operates exclusively on a separate copy
 * 7. Comprehensive resource cleanup (mat.delete() calls) to prevent mobile memory leaks
 */

// Global window declaration for OpenCV.js
declare global {
  interface Window {
    cv?: any;
    Module?: any;
  }
}

/**
 * Single source of truth configuration thresholds for calibration with real artisan craft images.
 */
export const OPENCV_QUALITY_CONFIG = {
  // Laplacian variance threshold for sharpness (lower values = blurry)
  SHARPNESS_BLURRY_THRESHOLD: 45.0,

  // Mean luminance threshold (0 - 255)
  BRIGHTNESS_TOO_DARK_THRESHOLD: 40.0,
  BRIGHTNESS_TOO_BRIGHT_THRESHOLD: 225.0,

  // Histogram-based exposure thresholds (percentage of pixels in dark/bright bins)
  HIST_UNDEREXPOSURE_RATIO: 0.45, // >45% pixels in lowest luminance bins
  HIST_OVEREXPOSURE_RATIO: 0.40,  // >40% pixels in highest luminance bins

  // Contrast threshold (standard deviation of grayscale values)
  CONTRAST_LOW_THRESHOLD: 24.0,

  // Maximum dimension for the OpenCV processing copy (preserves full original separate)
  MAX_PROCESS_DIMENSION: 1600,

  // CDN endpoints for browser OpenCV.js
  OPENCV_CDN_URLS: [
    "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.1/dist/opencv.js",
    "https://docs.opencv.org/4.8.0/opencv.js",
  ],
} as const;

export interface ImageQualityMetrics {
  sharpness: number;
  brightness: number;
  contrast: number;
  darkPixelFraction: number;
  brightPixelFraction: number;
}

export interface ImageQualityResult {
  sharpness: number;
  brightness: number;
  contrast: number;
  isBlurry: boolean;
  isTooDark: boolean;
  isTooBright: boolean;
  isLowContrast: boolean;
  qualityPassed: boolean;
  warnings: string[];
  metrics?: ImageQualityMetrics;
}

export interface ProcessedCaptureOutput {
  originalImage: string; // The untouched, preserved raw capture
  processedImage: string; // Quality-validated & conservatively preprocessed copy
  quality: ImageQualityResult;
  usedOpenCV: boolean;
}

let openCvLoadPromise: Promise<boolean> | null = null;

/**
 * Loads OpenCV.js asynchronously into the browser environment.
 * If loading fails or times out, returns false without throwing to ensure non-blocking fallback.
 */
export function loadOpenCV(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);

  if (window.cv && window.cv.Mat) {
    return Promise.resolve(true);
  }

  if (openCvLoadPromise) {
    return openCvLoadPromise;
  }

  openCvLoadPromise = new Promise<boolean>((resolve) => {
    let settled = false;

    // Timeout safety for poor mobile connections: don't block artisan scanning
    const timeoutTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.warn("[OpenCV] Loading timed out, falling back gracefully to native pipeline.");
        resolve(false);
      }
    }, 8000);

    const tryLoadFromUrls = async (urls: readonly string[]): Promise<boolean> => {
      for (const url of urls) {
        try {
          const success = await new Promise<boolean>((res) => {
            // Check again if already available
            if (window.cv && window.cv.Mat) {
              res(true);
              return;
            }

            const script = document.createElement("script");
            script.src = url;
            script.async = true;
            script.crossOrigin = "anonymous";

            window.Module = {
              onRuntimeInitialized: () => {
                res(true);
              },
            };

            script.onload = () => {
              if (window.cv && window.cv.Mat) {
                res(true);
              }
            };

            script.onerror = () => {
              console.warn(`[OpenCV] Failed loading from ${url}`);
              res(false);
            };

            document.head.appendChild(script);
          });

          if (success) return true;
        } catch {
          // Continue to next mirror
        }
      }
      return false;
    };

    tryLoadFromUrls(OPENCV_QUALITY_CONFIG.OPENCV_CDN_URLS)
      .then((loaded) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutTimer);
          if (loaded && window.cv && window.cv.Mat) {
            console.info("[OpenCV.js] Engine successfully initialized.");
            resolve(true);
          } else {
            console.warn("[OpenCV.js] Unavailable on client device; native fallback will be used.");
            resolve(false);
          }
        }
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutTimer);
          console.warn("[OpenCV.js] Initialization error:", err);
          resolve(false);
        }
      });
  });

  return openCvLoadPromise;
}

/**
 * Helper to load HTMLImageElement from base64 data URL
 */
function createImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

/**
 * Calculates Laplacian variance for sharpness/blur detection.
 * High variance = sharp edges; Low variance = blurry image.
 */
function computeLaplacianVariance(cv: any, grayMat: any): number {
  const laplacianMat = new cv.Mat();
  const meanMat = new cv.Mat();
  const stddevMat = new cv.Mat();

  try {
    // Compute second spatial derivatives using Laplacian operator with CV_64F depth
    cv.Laplacian(grayMat, laplacianMat, cv.CV_64F);
    cv.meanStdDev(laplacianMat, meanMat, stddevMat);

    const stddev = stddevMat.doubleAt(0, 0);
    const variance = stddev * stddev;
    return Number.isFinite(variance) ? Math.round(variance * 10) / 10 : 0;
  } finally {
    laplacianMat.delete();
    meanMat.delete();
    stddevMat.delete();
  }
}

/**
 * Calculates image brightness and exposure using OpenCV histogram analysis (cv.calcHist)
 * and mean-stddev luminance statistics.
 *
 * Inspects:
 * - Weighted mean brightness across all 256 grayscale intensity levels
 * - Histogram distribution: fraction of pixels in shadow bins (0-40) and highlight bins (215-255)
 */
function analyzeBrightnessAndHistogram(cv: any, grayMat: any): {
  brightness: number;
  contrast: number;
  isTooDark: boolean;
  isTooBright: boolean;
  darkFraction: number;
  brightFraction: number;
} {
  const meanMat = new cv.Mat();
  const stddevMat = new cv.Mat();

  // Mats for calcHist
  const srcVec = new cv.MatVector();
  const histMat = new cv.Mat();
  const mask = new cv.Mat();

  try {
    // 1. Mean and standard deviation
    cv.meanStdDev(grayMat, meanMat, stddevMat);
    const brightness = Math.round(meanMat.doubleAt(0, 0) * 10) / 10;
    const contrast = Math.round(stddevMat.doubleAt(0, 0) * 10) / 10;

    // 2. Histogram analysis using cv.calcHist (256 bins for single-channel grayscale)
    srcVec.push_back(grayMat);
    const channels = [0];
    const histSize = [256];
    const ranges = [0, 256];

    cv.calcHist(srcVec, channels, mask, histMat, histSize, ranges);

    const totalPixels = grayMat.rows * grayMat.cols;
    let darkPixels = 0;
    let brightPixels = 0;

    // Sum bins 0..40 for deep shadow / underexposure
    for (let i = 0; i <= 40; i++) {
      darkPixels += histMat.floatAt(i, 0);
    }

    // Sum bins 215..255 for specular blowouts / severe overexposure
    for (let i = 215; i < 256; i++) {
      brightPixels += histMat.floatAt(i, 0);
    }

    const darkFraction = totalPixels > 0 ? darkPixels / totalPixels : 0;
    const brightFraction = totalPixels > 0 ? brightPixels / totalPixels : 0;

    // Determine underexposed or overexposed based on mean luminance AND histogram distribution
    const isTooDark =
      brightness < OPENCV_QUALITY_CONFIG.BRIGHTNESS_TOO_DARK_THRESHOLD ||
      darkFraction > OPENCV_QUALITY_CONFIG.HIST_UNDEREXPOSURE_RATIO;

    const isTooBright =
      brightness > OPENCV_QUALITY_CONFIG.BRIGHTNESS_TOO_BRIGHT_THRESHOLD ||
      brightFraction > OPENCV_QUALITY_CONFIG.HIST_OVEREXPOSURE_RATIO;

    return {
      brightness,
      contrast,
      isTooDark,
      isTooBright,
      darkFraction: Math.round(darkFraction * 1000) / 1000,
      brightFraction: Math.round(brightFraction * 1000) / 1000,
    };
  } finally {
    meanMat.delete();
    stddevMat.delete();
    srcVec.delete();
    histMat.delete();
    mask.delete();
  }
}

/**
 * Conservative mild sharpening & light noise reduction:
 * Preserves intricate artisan craft textures (embroidery, weave, jewellery, pottery carvings)
 * by applying an unsharp-mask with very gentle blend weight (alpha ~ 1.1, beta ~ -0.1).
 */
function applyConservativeEnhancement(cv: any, srcMat: any): any {
  const blurred = new cv.Mat();
  const sharpened = new cv.Mat();
  try {
    // 3x3 gentle Gaussian blur to establish baseline spatial frequency
    const ksize = new cv.Size(3, 3);
    cv.GaussianBlur(srcMat, blurred, ksize, 0, 0, cv.BORDER_DEFAULT);

    // Unsharp mask: src * 1.1 - blurred * 0.1 (extremely conservative, non-destructive to craft motifs)
    cv.addWeighted(srcMat, 1.1, blurred, -0.1, 0, sharpened);
    return sharpened;
  } catch (err) {
    console.warn("[OpenCV] Conservative enhancement fallback:", err);
    sharpened.delete();
    return srcMat.clone();
  } finally {
    blurred.delete();
  }
}

/**
 * Fallback browser canvas implementation for quality metrics when OpenCV is not loaded.
 * Ensures the app never breaks on offline, unsupported, or restricted mobile devices.
 */
function evaluateCanvasQualityFallback(img: HTMLImageElement): { quality: ImageQualityResult; copyDataUrl: string } {
  const canvas = document.createElement("canvas");
  const maxDim = OPENCV_QUALITY_CONFIG.MAX_PROCESS_DIMENSION;
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;

  if (w > maxDim || h > maxDim) {
    if (w > h) {
      h = Math.round((h * maxDim) / w);
      w = maxDim;
    } else {
      w = Math.round((w * maxDim) / h);
      h = maxDim;
    }
  }

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    return {
      quality: {
        sharpness: 60,
        brightness: 128,
        contrast: 50,
        isBlurry: false,
        isTooDark: false,
        isTooBright: false,
        isLowContrast: false,
        qualityPassed: true,
        warnings: [],
      },
      copyDataUrl: img.src,
    };
  }

  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // Histogram calculation in pure JS canvas fallback (256 bins)
  const histogram = new Uint32Array(256);
  let totalLuma = 0;
  const totalPixels = w * h;

  for (let i = 0; i < data.length; i += 4) {
    const luma = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    histogram[luma]++;
    totalLuma += luma;
  }

  const brightness = totalPixels > 0 ? Math.round((totalLuma / totalPixels) * 10) / 10 : 128;

  let varianceSum = 0;
  for (let i = 0; i < 256; i++) {
    const count = histogram[i];
    if (count > 0) {
      varianceSum += count * (i - brightness) ** 2;
    }
  }
  const contrast = totalPixels > 0 ? Math.round(Math.sqrt(varianceSum / totalPixels) * 10) / 10 : 45;

  let darkPixels = 0;
  for (let i = 0; i <= 40; i++) darkPixels += histogram[i];
  let brightPixels = 0;
  for (let i = 215; i < 256; i++) brightPixels += histogram[i];

  const darkFraction = totalPixels > 0 ? darkPixels / totalPixels : 0;
  const brightFraction = totalPixels > 0 ? brightPixels / totalPixels : 0;

  const isTooDark =
    brightness < OPENCV_QUALITY_CONFIG.BRIGHTNESS_TOO_DARK_THRESHOLD ||
    darkFraction > OPENCV_QUALITY_CONFIG.HIST_UNDEREXPOSURE_RATIO;
  const isTooBright =
    brightness > OPENCV_QUALITY_CONFIG.BRIGHTNESS_TOO_BRIGHT_THRESHOLD ||
    brightFraction > OPENCV_QUALITY_CONFIG.HIST_OVEREXPOSURE_RATIO;
  const isLowContrast = contrast < OPENCV_QUALITY_CONFIG.CONTRAST_LOW_THRESHOLD;

  const warnings: string[] = [];
  if (isTooDark) warnings.push("Image is too dark. Please move to a brighter area.");
  if (isTooBright) warnings.push("Image is overexposed. Please reduce direct glare and capture again.");
  if (isLowContrast) warnings.push("Lighting has low contrast. Try capturing near natural light.");

  return {
    quality: {
      sharpness: 55, // safe nominal for fallback
      brightness,
      contrast,
      isBlurry: false,
      isTooDark,
      isTooBright,
      isLowContrast,
      qualityPassed: !isTooDark && !isTooBright,
      warnings,
      metrics: {
        sharpness: 55,
        brightness,
        contrast,
        darkPixelFraction: Math.round(darkFraction * 1000) / 1000,
        brightPixelFraction: Math.round(brightFraction * 1000) / 1000,
      },
    },
    copyDataUrl: canvas.toDataURL("image/jpeg", 0.94),
  };
}

/**
 * Detects image quality directly from an HTMLCanvasElement or OffscreenCanvas without modifying it.
 * Preserves the input canvas strictly as read-only.
 */
export function detectCanvasImageQuality(sourceCanvas: HTMLCanvasElement): ImageQualityResult {
  const isOpenCvAvailable = window.cv && window.cv.Mat && typeof window.cv.imread === "function";

  if (!isOpenCvAvailable) {
    // Pure canvas fallback
    const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return {
        sharpness: 60,
        brightness: 128,
        contrast: 50,
        isBlurry: false,
        isTooDark: false,
        isTooBright: false,
        isLowContrast: false,
        qualityPassed: true,
        warnings: [],
      };
    }

    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const totalPixels = w * h;

    const hist = new Uint32Array(256);
    let totalLuma = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luma = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      hist[luma]++;
      totalLuma += luma;
    }
    const brightness = totalPixels > 0 ? Math.round((totalLuma / totalPixels) * 10) / 10 : 128;
    let varSum = 0;
    for (let i = 0; i < 256; i++) {
      if (hist[i] > 0) varSum += hist[i] * (i - brightness) ** 2;
    }
    const contrast = totalPixels > 0 ? Math.round(Math.sqrt(varSum / totalPixels) * 10) / 10 : 45;

    let dark = 0;
    for (let i = 0; i <= 40; i++) dark += hist[i];
    let bright = 0;
    for (let i = 215; i < 256; i++) bright += hist[i];

    const isDark = brightness < OPENCV_QUALITY_CONFIG.BRIGHTNESS_TOO_DARK_THRESHOLD || dark / totalPixels > 0.45;
    const isBright = brightness > OPENCV_QUALITY_CONFIG.BRIGHTNESS_TOO_BRIGHT_THRESHOLD || bright / totalPixels > 0.40;

    const warnings: string[] = [];
    if (isDark) warnings.push("Image is too dark. Please move to a brighter area.");
    if (isBright) warnings.push("Image is overexposed. Please reduce direct glare and capture again.");

    return {
      sharpness: 55,
      brightness,
      contrast,
      isBlurry: false,
      isTooDark: isDark,
      isTooBright: isBright,
      isLowContrast: contrast < OPENCV_QUALITY_CONFIG.CONTRAST_LOW_THRESHOLD,
      qualityPassed: !isDark && !isBright,
      warnings,
      metrics: {
        sharpness: 55,
        brightness,
        contrast,
        darkPixelFraction: Math.round((dark / totalPixels) * 1000) / 1000,
        brightPixelFraction: Math.round((bright / totalPixels) * 1000) / 1000,
      },
    };
  }

  const cv = window.cv;
  let srcMat: any = null;
  let grayMat: any = null;

  try {
    // Read from canvas without modifying it (cv.imread copies pixel buffer into Mat)
    srcMat = cv.imread(sourceCanvas);
    grayMat = new cv.Mat();
    cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);

    const sharpness = computeLaplacianVariance(cv, grayMat);
    const { brightness, contrast, isTooDark, isTooBright, darkFraction, brightFraction } =
      analyzeBrightnessAndHistogram(cv, grayMat);

    const isBlurry = sharpness < OPENCV_QUALITY_CONFIG.SHARPNESS_BLURRY_THRESHOLD;
    const isLowContrast = contrast < OPENCV_QUALITY_CONFIG.CONTRAST_LOW_THRESHOLD;

    const warnings: string[] = [];
    if (isBlurry) {
      warnings.push("Image is blurry. Please hold the phone steady and capture again.");
    }
    if (isTooDark) {
      warnings.push("Image is too dark. Please move to a brighter area.");
    }
    if (isTooBright) {
      warnings.push("Image is overexposed. Please reduce direct glare and capture again.");
    }
    if (isLowContrast) {
      warnings.push("Image has low contrast. Try capturing near natural light.");
    }

    const qualityPassed = !isBlurry && !isTooDark && !isTooBright;

    return {
      sharpness,
      brightness,
      contrast,
      isBlurry,
      isTooDark,
      isTooBright,
      isLowContrast,
      qualityPassed,
      warnings,
      metrics: {
        sharpness,
        brightness,
        contrast,
        darkPixelFraction: darkFraction,
        brightPixelFraction: brightFraction,
      },
    };
  } finally {
    if (srcMat) srcMat.delete();
    if (grayMat) grayMat.delete();
  }
}

/**
 * Main Product Scanning OpenCV Image Processing Pipeline.
 *
 * CRITICAL INVARIANT: The original captured image is NEVER mutated or destroyed.
 * OpenCV runs exclusively on an allocated processing copy.
 */
export async function processCapturedImageWithOpenCV(capturedImageBase64: string): Promise<ProcessedCaptureOutput> {
  // 1. Preserve original capture immutably
  const originalImage = capturedImageBase64;

  let imgElement: HTMLImageElement;
  try {
    imgElement = await createImage(capturedImageBase64);
  } catch (err) {
    console.error("[OpenCV Pipeline] Error reading captured image:", err);
    return {
      originalImage,
      processedImage: originalImage,
      quality: {
        sharpness: 50,
        brightness: 120,
        contrast: 40,
        isBlurry: false,
        isTooDark: false,
        isTooBright: false,
        isLowContrast: false,
        qualityPassed: true,
        warnings: [],
      },
      usedOpenCV: false,
    };
  }

  // 2. Check if OpenCV.js is ready
  const isOpenCvAvailable = window.cv && window.cv.Mat && typeof window.cv.imread === "function";

  if (!isOpenCvAvailable) {
    // Perform browser-native quality metrics and downscale copy
    const fallback = evaluateCanvasQualityFallback(imgElement);
    return {
      originalImage,
      processedImage: fallback.copyDataUrl,
      quality: fallback.quality,
      usedOpenCV: false,
    };
  }

  const cv = window.cv;

  // 3. Create a detached offscreen canvas copy for OpenCV processing (leaves original untouched)
  const maxDim = OPENCV_QUALITY_CONFIG.MAX_PROCESS_DIMENSION;
  let targetW = imgElement.naturalWidth || imgElement.width;
  let targetH = imgElement.naturalHeight || imgElement.height;

  if (targetW > maxDim || targetH > maxDim) {
    if (targetW > targetH) {
      targetH = Math.round((targetH * maxDim) / targetW);
      targetW = maxDim;
    } else {
      targetW = Math.round((targetW * maxDim) / targetH);
      targetH = maxDim;
    }
  }

  const offscreenCanvas = document.createElement("canvas");
  offscreenCanvas.width = targetW;
  offscreenCanvas.height = targetH;
  const ctx = offscreenCanvas.getContext("2d");
  if (!ctx) {
    const fallback = evaluateCanvasQualityFallback(imgElement);
    return {
      originalImage,
      processedImage: fallback.copyDataUrl,
      quality: fallback.quality,
      usedOpenCV: false,
    };
  }

  ctx.drawImage(imgElement, 0, 0, targetW, targetH);

  let srcMat: any = null;
  let grayMat: any = null;
  let enhancedMat: any = null;

  try {
    // Read the separate canvas copy into OpenCV Mat
    srcMat = cv.imread(offscreenCanvas);
    grayMat = new cv.Mat();

    // Convert to grayscale for sharpness, brightness, and contrast measurements
    cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);

    // 4. Measure Quality Metrics with Laplacian variance and Histogram analysis
    const sharpness = computeLaplacianVariance(cv, grayMat);
    const { brightness, contrast, isTooDark, isTooBright, darkFraction, brightFraction } =
      analyzeBrightnessAndHistogram(cv, grayMat);

    const isBlurry = sharpness < OPENCV_QUALITY_CONFIG.SHARPNESS_BLURRY_THRESHOLD;
    const isLowContrast = contrast < OPENCV_QUALITY_CONFIG.CONTRAST_LOW_THRESHOLD;

    const warnings: string[] = [];
    if (isBlurry) {
      warnings.push("Image is blurry. Please hold the phone steady and capture again.");
    }
    if (isTooDark) {
      warnings.push("Image is too dark. Please move to a brighter area.");
    }
    if (isTooBright) {
      warnings.push("Image is overexposed. Please reduce direct glare and capture again.");
    }
    if (isLowContrast) {
      warnings.push("Image has low contrast. Try capturing near natural light.");
    }

    // Determine quality pass (fails on severe blur, extreme darkness, or heavy glare)
    const qualityPassed = !isBlurry && !isTooDark && !isTooBright;

    // 5. Conservative preprocessing: apply craft-safe mild unsharp-mask enhancement
    enhancedMat = applyConservativeEnhancement(cv, srcMat);

    // Render processed copy back to offscreen canvas
    cv.imshow(offscreenCanvas, enhancedMat);
    const processedImage = offscreenCanvas.toDataURL("image/jpeg", 0.94);

    return {
      originalImage,
      processedImage,
      quality: {
        sharpness,
        brightness,
        contrast,
        isBlurry,
        isTooDark,
        isTooBright,
        isLowContrast,
        qualityPassed,
        warnings,
        metrics: {
          sharpness,
          brightness,
          contrast,
          darkPixelFraction: darkFraction,
          brightPixelFraction: brightFraction,
        },
      },
      usedOpenCV: true,
    };
  } catch (err) {
    console.error("[OpenCV Processing] Error during image quality pipeline:", err);
    // On unexpected OpenCV matrix error, fallback safely without modifying the image
    const fallback = evaluateCanvasQualityFallback(imgElement);
    return {
      originalImage,
      processedImage: fallback.copyDataUrl,
      quality: fallback.quality,
      usedOpenCV: false,
    };
  } finally {
    // 6. Strict memory cleanup: release all OpenCV Mat allocations to prevent memory leaks on mobile
    if (srcMat) srcMat.delete();
    if (grayMat) grayMat.delete();
    if (enhancedMat) enhancedMat.delete();
  }
}
