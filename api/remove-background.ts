import dotenv from "dotenv";
dotenv.config();

// Helper to reliably parse body from Vercel-parsed req.body or raw stream (Vite dev server)
async function parseRequestBody(req: any): Promise<{ imageBase64?: string; image?: string }> {
  if (req.body) {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body);
      } catch {
        throw new Error("Invalid JSON in request body");
      }
    }
    if (typeof req.body === "object") {
      return req.body;
    }
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: any) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (!raw.trim()) {
          resolve({});
          return;
        }
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", (err: any) => reject(err));
    if (typeof req.resume === "function") {
      req.resume();
    }
  });
}

function sendJson(res: any, status: number, data: any) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(status).json(data);
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

// Vercel Serverless Function for POST /api/remove-background
export default async function handler(req: any, res: any) {
  // CORS Configuration
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") {
    if (typeof res.status === "function" && typeof res.end === "function") {
      return res.status(200).end();
    }
    res.statusCode = 200;
    return res.end();
  }

  // Enforce POST requests only
  if (req.method !== "POST") {
    return sendJson(res, 405, {
      error: "Method not allowed. Only POST requests are accepted.",
    });
  }

  // Read BACKGROUND_REMOVAL_API_KEY from environment or container runtime configuration
  let apiKey = process.env.BACKGROUND_REMOVAL_API_KEY || process.env.VITE_BACKGROUND_REMOVAL_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    try {
      const fs = await import("fs");
      const devEnvPath = "/app/.dev.env.json";
      if (fs.existsSync(devEnvPath)) {
        const devEnv = JSON.parse(fs.readFileSync(devEnvPath, "utf-8"));
        if (devEnv.BACKGROUND_REMOVAL_API_KEY) {
          apiKey = devEnv.BACKGROUND_REMOVAL_API_KEY;
        }
      }
    } catch {}
  }
  if (apiKey) {
    process.env.BACKGROUND_REMOVAL_API_KEY = apiKey;
  }

  let payload: { imageBase64?: string; image?: string };
  try {
    payload = await parseRequestBody(req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Malformed request payload";
    return sendJson(res, 400, { error: msg });
  }

  const rawImage = payload.imageBase64 || payload.image;
  if (!rawImage || typeof rawImage !== "string") {
    return sendJson(res, 400, {
      error: "Invalid request. Please provide imageBase64.",
    });
  }

  if (!apiKey) {
    return sendJson(res, 500, {
      error: "BACKGROUND_REMOVAL_API_KEY environment variable is not configured.",
    });
  }

  // Strip data URI prefix to get pure base64
  const cleanBase64 = rawImage.replace(/^data:image\/[a-z0-9+]+;base64,/i, "").trim();

  try {
    const response = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "image/png",
      },
      body: JSON.stringify({
        image_file_b64: cleanBase64,
        size: "auto",
        format: "png",
      }),
    });

    if (!response.ok) {
      let errorDetail = "Background removal provider error";
      try {
        const errorJson = await response.json();
        if (errorJson?.errors?.[0]?.title) {
          errorDetail = errorJson.errors[0].title;
          if (errorJson.errors[0].detail) {
            errorDetail += `: ${errorJson.errors[0].detail}`;
          }
        }
      } catch {
        errorDetail = `Background removal provider responded with HTTP ${response.status}`;
      }
      return sendJson(res, response.status >= 400 && response.status < 500 ? response.status : 502, {
        error: errorDetail,
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64Png = Buffer.from(arrayBuffer).toString("base64");
    const transparentPng = `data:image/png;base64,${base64Png}`;

    return sendJson(res, 200, {
      success: true,
      transparentPng,
    });
  } catch (err: unknown) {
    console.error("Background removal API error:", err);
    const errorMessage = err instanceof Error ? err.message : "Background removal request failed";
    return sendJson(res, 500, { error: errorMessage });
  }
}
