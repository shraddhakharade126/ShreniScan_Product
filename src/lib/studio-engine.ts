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
    // High-precision client-side background segmentation using border color profiling and connected floodfill
    // 1. Gather perimeter pixels to build background color samples
    const bgSamples: { r: number; g: number; b: number }[] = [];
    const stepX = Math.max(1, Math.floor(w / 30));
    const stepY = Math.max(1, Math.floor(h / 30));

    // Sample top & bottom rows
    for (let x = 0; x < w; x += stepX) {
      const topIdx = x * 4;
      const botIdx = ((h - 1) * w + x) * 4;
      bgSamples.push({ r: data[topIdx], g: data[topIdx + 1], b: data[topIdx + 2] });
      bgSamples.push({ r: data[botIdx], g: data[botIdx + 1], b: data[botIdx + 2] });
    }
    // Sample left & right columns
    for (let y = 0; y < h; y += stepY) {
      const leftIdx = y * w * 4;
      const rightIdx = (y * w + (w - 1)) * 4;
      bgSamples.push({ r: data[leftIdx], g: data[leftIdx + 1], b: data[leftIdx + 2] });
      bgSamples.push({ r: data[rightIdx], g: data[rightIdx + 1], b: data[rightIdx + 2] });
    }

    // Compute mean background color
    let sumR = 0, sumG = 0, sumB = 0;
    for (const s of bgSamples) {
      sumR += s.r;
      sumG += s.g;
      sumB += s.b;
    }
    const bgR = sumR / bgSamples.length;
    const bgG = sumG / bgSamples.length;
    const bgB = sumB / bgSamples.length;

    // Background color distance function
    const colorDist = (r: number, g: number, b: number) => {
      // Perceptually weighted Euclidean distance (Red: 0.299, Green: 0.587, Blue: 0.114)
      return Math.sqrt(
        (r - bgR) ** 2 * 0.299 +
        (g - bgG) ** 2 * 0.587 +
        (b - bgB) ** 2 * 0.114
      );
    };

    // Calculate background variance to adjust tolerance
    let totalVar = 0;
    for (const s of bgSamples) {
      totalVar += colorDist(s.r, s.g, s.b);
    }
    const bgVariance = totalVar / bgSamples.length;
    const tolerance = Math.max(30, Math.min(65, bgVariance * 2.2 + 25));

    // 2. Breadth-first search (BFS) flood fill starting from all 4 borders
    const isBackground = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;

    // Seed borders into queue
    for (let x = 0; x < w; x++) {
      const top = x;
      const bot = (h - 1) * w + x;
      if (colorDist(data[top * 4], data[top * 4 + 1], data[top * 4 + 2]) < tolerance * 1.3) {
        isBackground[top] = 1;
        queue[tail++] = top;
      }
      if (colorDist(data[bot * 4], data[bot * 4 + 1], data[bot * 4 + 2]) < tolerance * 1.3) {
        isBackground[bot] = 1;
        queue[tail++] = bot;
      }
    }
    for (let y = 1; y < h - 1; y++) {
      const left = y * w;
      const right = y * w + (w - 1);
      if (!isBackground[left] && colorDist(data[left * 4], data[left * 4 + 1], data[left * 4 + 2]) < tolerance * 1.3) {
        isBackground[left] = 1;
        queue[tail++] = left;
      }
      if (!isBackground[right] && colorDist(data[right * 4], data[right * 4 + 1], data[right * 4 + 2]) < tolerance * 1.3) {
        isBackground[right] = 1;
        queue[tail++] = right;
      }
    }

    // Expand flood fill into background areas
    while (head < tail) {
      const curr = queue[head++];
      const cx = curr % w;
      const cy = Math.floor(curr / w);

      // Check 4 neighbors
      const neighbors = [
        cx > 0 ? curr - 1 : -1,
        cx < w - 1 ? curr + 1 : -1,
        cy > 0 ? curr - w : -1,
        cy < h - 1 ? curr + w : -1,
      ];

      for (const n of neighbors) {
        if (n >= 0 && !isBackground[n]) {
          const idx = n * 4;
          const dist = colorDist(data[idx], data[idx + 1], data[idx + 2]);
          if (dist < tolerance) {
            isBackground[n] = 1;
            queue[tail++] = n;
          }
        }
      }
    }

    // 3. Populate alpha mask: background is 0 (transparent), foreground craft is 255 (opaque)
    for (let i = 0; i < w * h; i++) {
      alphaMask[i] = isBackground[i] ? 0 : 255;
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

/**
 * Convenience helper that takes any image source and returns an isolated transparent PNG data URL.
 */
export async function segmentImageClientSide(imageSource: string | HTMLImageElement): Promise<string> {
  return processStudioImage(imageSource, {
    backdrop: "transparent",
    brightness: 0,
    contrast: 0,
    warmth: 0,
    edgeSoftness: 2,
    shadow: false,
    shadowIntensity: 0,
  });
}
