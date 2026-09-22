import dotenv from "dotenv";
dotenv.config();

export default function handler(_req: any, res: any) {
  const data = {
    status: "ok",
    pwa: true,
    gemini: Boolean(process.env.GEMINI_API_KEY),
    backgroundRemoval: Boolean(process.env.BACKGROUND_REMOVAL_API_KEY),
    platform: "vercel",
  };

  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(200).json(data);
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}
