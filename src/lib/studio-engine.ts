/**
 * Real client-side canvas studio engine for KalaKart Shreni Scan & Studio.
 * Performs intelligent background isolation, edge softening, color adjustments,
 * studio backdrop replacement, and realistic floor shadow rendering.
 */

export type BackdropType = "white" | "ivory" | "terracotta" | "gray" | "charcoal" | "transparent";

export interface StudioOptions {
  backdrop: BackdropType;
  brightness: number; // -50 to 50
  contrast: number; // -50 to 50
  warmth: number; // -50 to 50
  edgeSoftness: number; // 0 to 10
  shadow: boolean;
  shadowIntensity: number; // 0 to 100
  splitRatio?: number; // 0 to 1 for Before/After split view
  originalImage?: string; // Original image with background for Before/After comparison
}

export const BACKDROP_COLORS: Record<BackdropType, string> = {
  white: "#ffffff",
  ivory: "#fbf7ee",
  terracotta: "#f7eee6",
  gray: "#f3f4f6",
  charcoal: "#1f2937",
  transparent: "transparent",
};

/**
 * Loads an image from a URL or data URL
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

/**
 * Perform client-side intelligent background segmentation and studio enhancement.
 */
export async function processStudioImage(
  imageSource: string | HTMLImageElement,
  options: StudioOptions
): Promise<string> {
  const img = typeof imageSource === "string" ? await loadImage(imageSource) : imageSource;

  // Render on offscreen canvas
  const canvas = document.createElement("canvas");
  const maxDim = 1200;
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
  if (!ctx) throw new Error("Could not get 2D canvas context");

  // Draw original image
  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // Check if image already has transparent alpha channels (e.g. from dedicated background removal API)
  let transparentPixelCount = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 240) {
      transparentPixelCount++;
    }
  }
  const isDedicatedTransparent = transparentPixelCount > (w * h * 0.02);

  const alphaMask = new Uint8ClampedArray(w * h);

  if (isDedicatedTransparent) {
    // Use the authentic transparent craft mask provided by the dedicated background removal API
    for (let i = 0; i < w * h; i++) {
      alphaMask[i] = data[i * 4 + 3];
    }
  } else {
    // Fallback client-side segmentation when offline or before API response
    // Sample perimeter corner pixels to estimate background color profile
    const samplePoints = [
      { x: 4, y: 4 },
      { x: w - 5, y: 4 },
      { x: 4, y: h - 5 },
      { x: w - 5, y: h - 5 },
      { x: Math.floor(w / 2), y: 4 },
      { x: 4, y: Math.floor(h / 2) },
      { x: w - 5, y: Math.floor(h / 2) },
    ];

    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    for (const pt of samplePoints) {
      const idx = (pt.y * w + pt.x) * 4;
      sumR += data[idx];
      sumG += data[idx + 1];
      sumB += data[idx + 2];
      count++;
    }
    const bgR = sumR / count;
    const bgG = sumG / count;
    const bgB = sumB / count;

    // Measure perimeter color variance to check background consistency
    let variance = 0;
    for (const pt of samplePoints) {
      const idx = (pt.y * w + pt.x) * 4;
      const diff = Math.sqrt(
        (data[idx] - bgR) ** 2 +
        (data[idx + 1] - bgG) ** 2 +
        (data[idx + 2] - bgB) ** 2
      );
      variance += diff;
    }
    const avgBgVariance = variance / count;

    // Measure contrast between central craft region and perimeter
    const centerIdx = (Math.floor(h / 2) * w + Math.floor(w / 2)) * 4;
    const centerContrast = Math.sqrt(
      (data[centerIdx] - bgR) ** 2 * 0.3 +
      (data[centerIdx + 1] - bgG) ** 2 * 0.59 +
      (data[centerIdx + 2] - bgB) ** 2 * 0.11
    );

    const isLowConfidence = centerContrast < 22 || avgBgVariance > 55;
    const tolerance = isLowConfidence ? 28 : 42;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Distance from estimated background color
        const colorDist = Math.sqrt(
          (r - bgR) ** 2 * 0.3 + (g - bgG) ** 2 * 0.59 + (b - bgB) ** 2 * 0.11
        );

        // Edge proximity boost (center of image is very likely foreground craft)
        const distFromCenterNorm = Math.sqrt(
          ((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2
        );

        let alpha = 255;
        if (colorDist < tolerance) {
          const factor = colorDist / tolerance;
          alpha = Math.round(factor * 255);
        } else {
          alpha = 255;
        }

        const preserveThreshold = isLowConfidence ? 0.85 : 0.65;
        if (distFromCenterNorm < preserveThreshold) {
          alpha = Math.max(alpha, isLowConfidence ? 255 : 240);
        }

        alphaMask[y * w + x] = alpha;
      }
    }
  }

  // Edge softening / box blur on mask if edgeSoftness > 0
  if (options.edgeSoftness > 0) {
    const radius = Math.min(6, Math.round(options.edgeSoftness));
    const smoothed = new Uint8ClampedArray(w * h);
    for (let y = radius; y < h - radius; y++) {
      for (let x = radius; x < w - radius; x++) {
        let sum = 0;
        let c = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            sum += alphaMask[(y + dy) * w + (x + dx)];
            c++;
          }
        }
        smoothed[y * w + x] = Math.round(sum / c);
      }
    }
    for (let i = 0; i < alphaMask.length; i++) {
      if (smoothed[i] > 0) alphaMask[i] = smoothed[i];
    }
  }

  // Create clean canvas for the output
  const outCanvas = document.createElement("canvas");
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("Could not get output context");

  // 1. Draw Backdrop
  if (options.backdrop !== "transparent") {
    outCtx.fillStyle = BACKDROP_COLORS[options.backdrop];
    outCtx.fillRect(0, 0, w, h);
  }

  // 2. Add realistic soft studio contact floor shadow
  if (options.shadow && options.backdrop !== "transparent") {
    const shadowIntensity = (options.shadowIntensity ?? 50) / 100;
    outCtx.save();
    outCtx.beginPath();
    const shadowY = h * 0.88;
    const shadowRadiusX = w * 0.32;
    const shadowRadiusY = h * 0.045;
    const grad = outCtx.createRadialGradient(
      w / 2,
      shadowY,
      0,
      w / 2,
      shadowY,
      shadowRadiusX
    );
    grad.addColorStop(0, `rgba(0, 0, 0, ${0.35 * shadowIntensity})`);
    grad.addColorStop(0.5, `rgba(0, 0, 0, ${0.12 * shadowIntensity})`);
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    outCtx.fillStyle = grad;
    outCtx.ellipse(w / 2, shadowY, shadowRadiusX, shadowRadiusY, 0, 0, Math.PI * 2);
    outCtx.fill();
    outCtx.restore();
  }

  // 3. Render foreground with adjustments
  const bFactor = options.brightness / 100; // -0.5 to 0.5
  const cFactor = (options.contrast + 100) / 100; // 0.5 to 1.5
  const wFactor = options.warmth / 100; // -0.5 to 0.5

  const fgData = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const alpha = alphaMask[i];

    if (alpha > 0) {
      let r = data[p];
      let g = data[p + 1];
      let b = data[p + 2];

      // Brightness
      r += bFactor * 255;
      g += bFactor * 255;
      b += bFactor * 255;

      // Contrast
      r = (r - 128) * cFactor + 128;
      g = (g - 128) * cFactor + 128;
      b = (b - 128) * cFactor + 128;

      // Warmth (warm = +red/-blue, cool = +blue/-red)
      r += wFactor * 30;
      g += wFactor * 10;
      b -= wFactor * 30;

      // Clamp
      fgData.data[p] = Math.min(255, Math.max(0, r));
      fgData.data[p + 1] = Math.min(255, Math.max(0, g));
      fgData.data[p + 2] = Math.min(255, Math.max(0, b));
      fgData.data[p + 3] = alpha;
    } else {
      fgData.data[p + 3] = 0;
    }
  }

  // Draw isolated foreground onto temporary canvas to render over backdrop
  const fgCanvas = document.createElement("canvas");
  fgCanvas.width = w;
  fgCanvas.height = h;
  const fgCtx = fgCanvas.getContext("2d")!;
  fgCtx.putImageData(fgData, 0, 0);

  outCtx.drawImage(fgCanvas, 0, 0);

  // If a split ratio is requested (Before/After comparison)
  if (options.splitRatio !== undefined && options.splitRatio >= 0 && options.splitRatio <= 1) {
    const splitX = Math.round(w * options.splitRatio);
    const beforeImg = options.originalImage ? await loadImage(options.originalImage) : img;
    // Draw original image on the left portion
    outCtx.save();
    outCtx.beginPath();
    outCtx.rect(0, 0, splitX, h);
    outCtx.clip();
    outCtx.drawImage(beforeImg, 0, 0, w, h);
    outCtx.restore();

    // Draw clean divider line
    outCtx.strokeStyle = "#b45309";
    outCtx.lineWidth = 3;
    outCtx.beginPath();
    outCtx.moveTo(splitX, 0);
    outCtx.lineTo(splitX, h);
    outCtx.stroke();
  }

  return outCanvas.toDataURL(options.backdrop === "transparent" ? "image/png" : "image/jpeg", 0.92);
}
