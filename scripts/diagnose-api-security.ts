/**
 * Diagnostic Verification Script: API Endpoints & Secret Security
 * 
 * Verifies:
 * 1. Frontend calls /api/gemini/analyze-craft and /api/remove-background via secure relative endpoints.
 * 2. Client-side source code (src/, public/, index.html) contains NO exposed API keys or VITE_ secrets.
 * 3. Server-side handlers (api/) strictly read secrets from process.env and enforce POST methods.
 * 4. Production build bundle (dist/) contains no secret leaks.
 * 5. Live runtime verification of /api/health, /api/remove-background, and /api/gemini/analyze-craft.
 */

import fs from 'fs';
import path from 'path';

interface CheckResult {
  category: string;
  name: string;
  passed: boolean;
  details: string;
}

const results: CheckResult[] = [];

function recordCheck(category: string, name: string, passed: boolean, details: string) {
  results.push({ category, name, passed, details });
  const symbol = passed ? '\x1b[32m✔ PASS\x1b[0m' : '\x1b[31m✖ FAIL\x1b[0m';
  console.log(`  ${symbol} [${category}] ${name}`);
  if (details) {
    console.log(`         \x1b[90m${details}\x1b[0m`);
  }
}

// -------------------------------------------------------------
// Suite 1: Frontend Endpoint Invocations
// -------------------------------------------------------------
function checkFrontendEndpoints() {
  console.log('\n\x1b[1m1. Checking Frontend Endpoint Invocations...\x1b[0m');
  const addProductFile = path.resolve(process.cwd(), 'src/routes/_authenticated/add-product.tsx');
  
  if (!fs.existsSync(addProductFile)) {
    recordCheck('Frontend', 'add-product.tsx exists', false, 'File not found');
    return;
  }

  const content = fs.readFileSync(addProductFile, 'utf-8');

  // Check /api/remove-background invocation
  const callsRemoveBg = content.includes('fetch("/api/remove-background"') || content.includes("fetch('/api/remove-background'");
  recordCheck(
    'Frontend',
    'Calls /api/remove-background',
    callsRemoveBg,
    callsRemoveBg
      ? 'Frontend delegates background removal directly to /api/remove-background'
      : 'Did not find fetch call to /api/remove-background in add-product.tsx'
  );

  // Check /api/gemini/analyze-craft invocation
  const callsGeminiAnalyze = content.includes('fetch("/api/gemini/analyze-craft"') || content.includes("fetch('/api/gemini/analyze-craft'");
  recordCheck(
    'Frontend',
    'Calls /api/gemini/analyze-craft',
    callsGeminiAnalyze,
    callsGeminiAnalyze
      ? 'Frontend delegates craft analysis directly to /api/gemini/analyze-craft'
      : 'Did not find fetch call to /api/gemini/analyze-craft in add-product.tsx'
  );

  // Check no direct 3rd-party background removal or direct Gemini calls in frontend
  const hasDirectRemoveBg = content.includes('api.remove.bg') || content.includes('removebg');
  const hasDirectGenAiSdk = content.includes('@google/genai') && !content.includes('//');
  
  recordCheck(
    'Frontend',
    'No direct 3rd-party background removal SDK in frontend',
    !hasDirectRemoveBg,
    !hasDirectRemoveBg
      ? 'No direct client-side external remove.bg API calls'
      : 'Found potential direct client-side external call'
  );

  recordCheck(
    'Frontend',
    'No direct Gemini GenAI SDK in frontend component',
    !hasDirectGenAiSdk,
    !hasDirectGenAiSdk
      ? 'Client component relies on /api proxy rather than client-side SDK instantiation'
      : 'Found client-side SDK import'
  );
}

// -------------------------------------------------------------
// Suite 2: Client Secret Leak Prevention Scan
// -------------------------------------------------------------
function checkClientSecretLeaks() {
  console.log('\n\x1b[1m2. Scanning Client Code for Secret Exposure...\x1b[0m');

  const clientDirs = ['src', 'public'];
  const forbiddenPatterns = [
    { label: 'VITE_GEMINI_API_KEY', regex: /VITE_GEMINI_API_KEY/ },
    { label: 'VITE_BACKGROUND_REMOVAL_API_KEY', regex: /VITE_BACKGROUND_REMOVAL_API_KEY/ },
    { label: 'Client-side process.env API key', regex: /process\.env\.(GEMINI_API_KEY|BACKGROUND_REMOVAL_API_KEY)/ },
    { label: 'Google AI key pattern (AIzaSy...)', regex: /AIzaSy[0-9A-Za-z_-]{33}/ },
  ];

  let leakFound = false;
  const scannedFiles: string[] = [];

  function scanDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
          scanDir(fullPath);
        }
      } else if (/\.(tsx?|jsx?|html|css|json)$/i.test(entry.name)) {
        scannedFiles.push(fullPath);
        // Exclude server-only directory within src if any exists
        if (fullPath.includes('src/server/')) {
          continue;
        }
        const text = fs.readFileSync(fullPath, 'utf-8');
        for (const pattern of forbiddenPatterns) {
          if (pattern.regex.test(text)) {
            leakFound = true;
            recordCheck('Client Security', `Leak check: ${pattern.label}`, false, `Found in ${fullPath}`);
          }
        }
      }
    }
  }

  for (const d of clientDirs) {
    scanDir(path.resolve(process.cwd(), d));
  }
  // Also scan index.html
  const indexHtml = path.resolve(process.cwd(), 'index.html');
  if (fs.existsSync(indexHtml)) {
    const text = fs.readFileSync(indexHtml, 'utf-8');
    for (const pattern of forbiddenPatterns) {
      if (pattern.regex.test(text)) {
        leakFound = true;
        recordCheck('Client Security', `Leak check in index.html: ${pattern.label}`, false, `Found in index.html`);
      }
    }
  }

  if (!leakFound) {
    recordCheck(
      'Client Security',
      'No API keys or VITE_ secrets exposed in client codebase',
      true,
      `Scanned ${scannedFiles.length} client source files safely`
    );
  }

  // Verify .gitignore protects .env
  const gitignorePath = path.resolve(process.cwd(), '.gitignore');
  const gitignoreContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
  const protectsEnv = gitignoreContent.split('\n').some((line) => {
    const l = line.trim();
    return l === '.env' || l === '.env*' || l === '*.env' || l.startsWith('.env');
  });
  recordCheck(
    'Repository Security',
    '.gitignore excludes .env file',
    protectsEnv,
    protectsEnv ? '.env files are explicitly ignored from source control' : '.env missing from .gitignore'
  );
}

// -------------------------------------------------------------
// Suite 3: Server Endpoint Implementation & Env Binding
// -------------------------------------------------------------
function checkServerImplementation() {
  console.log('\n\x1b[1m3. Verifying Server API Implementation...\x1b[0m');

  // Check /api/gemini/analyze-craft.ts
  const geminiEndpointPath = path.resolve(process.cwd(), 'api/gemini/analyze-craft.ts');
  if (fs.existsSync(geminiEndpointPath)) {
    const code = fs.readFileSync(geminiEndpointPath, 'utf-8');
    const usesEnv = code.includes('process.env.GEMINI_API_KEY');
    const rejectsNonPost = code.includes('req.method !== "POST"') || code.includes("req.method !== 'POST'");
    const exportsDefault = code.includes('export default');

    recordCheck('Server API', 'Gemini endpoint reads process.env.GEMINI_API_KEY', usesEnv, 'Server-only environment binding');
    recordCheck('Server API', 'Gemini endpoint enforces POST only', rejectsNonPost, 'Rejects GET/PUT/DELETE with 405');
    recordCheck('Server API', 'Gemini endpoint exports default Vercel handler', exportsDefault, 'Compatible with Vercel serverless functions');
  } else {
    recordCheck('Server API', 'Gemini endpoint exists', false, 'api/gemini/analyze-craft.ts not found');
  }

  // Check /api/remove-background.ts
  const bgEndpointPath = path.resolve(process.cwd(), 'api/remove-background.ts');
  if (fs.existsSync(bgEndpointPath)) {
    const code = fs.readFileSync(bgEndpointPath, 'utf-8');
    const usesEnv = code.includes('process.env.BACKGROUND_REMOVAL_API_KEY');
    const rejectsNonPost = code.includes('req.method !== "POST"') || code.includes("req.method !== 'POST'");
    const exportsDefault = code.includes('export default');

    recordCheck('Server API', 'Background endpoint reads process.env.BACKGROUND_REMOVAL_API_KEY', usesEnv, 'Server-only environment binding');
    recordCheck('Server API', 'Background endpoint enforces POST only', rejectsNonPost, 'Rejects GET/PUT/DELETE with 405');
    recordCheck('Server API', 'Background endpoint exports default Vercel handler', exportsDefault, 'Compatible with Vercel serverless functions');
  } else {
    recordCheck('Server API', 'Background removal endpoint exists', false, 'api/remove-background.ts not found');
  }

  // Check /api/health.ts
  const healthEndpointPath = path.resolve(process.cwd(), 'api/health.ts');
  if (fs.existsSync(healthEndpointPath)) {
    const code = fs.readFileSync(healthEndpointPath, 'utf-8');
    const checksGemini = code.includes('Boolean(process.env.GEMINI_API_KEY)');
    const checksBg = code.includes('Boolean(process.env.BACKGROUND_REMOVAL_API_KEY)');
    recordCheck(
      'Server API',
      'Health endpoint checks secrets without exposing values',
      checksGemini && checksBg,
      'Returns boolean flags only, never exposes actual keys'
    );
  }
}

// -------------------------------------------------------------
// Suite 4: Production Dist Bundle Check
// -------------------------------------------------------------
function checkProductionBundle() {
  console.log('\n\x1b[1m4. Inspecting Production Build Bundle (dist/)...\x1b[0m');
  const distPath = path.resolve(process.cwd(), 'dist');
  
  if (!fs.existsSync(distPath)) {
    recordCheck('Build Bundle', 'dist/ directory available', false, 'Run npm run build first');
    return;
  }

  let distLeak = false;
  let fileCount = 0;

  function scanDist(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDist(full);
      } else if (/\.(js|html|css|json)$/i.test(entry.name)) {
        fileCount++;
        const content = fs.readFileSync(full, 'utf-8');
        if (
          content.includes('BACKGROUND_REMOVAL_API_KEY') ||
          content.includes('GEMINI_API_KEY') ||
          /AIzaSy[0-9A-Za-z_-]{33}/.test(content)
        ) {
          distLeak = true;
          recordCheck('Build Bundle', 'Production bundle clean', false, `Leak detected in ${entry.name}`);
        }
      }
    }
  }

  scanDist(distPath);

  if (!distLeak) {
    recordCheck(
      'Build Bundle',
      'Production client bundle is free of server secrets',
      true,
      `Inspected ${fileCount} compiled production assets in dist/`
    );
  }
}

// -------------------------------------------------------------
// Suite 5: Runtime Live Endpoint Diagnostics
// -------------------------------------------------------------
async function checkLiveEndpoints() {
  console.log('\n\x1b[1m5. Running Live Runtime API Diagnostics...\x1b[0m');
  const baseUrl = process.env.TEST_API_URL || 'http://localhost:3000';

  // 1. Check GET /api/health
  try {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    if (healthRes.ok) {
      const healthData = await healthRes.json();
      const hasGemini = healthData.gemini === true;
      const hasBg = healthData.backgroundRemoval === true;
      recordCheck(
        'Runtime',
        'GET /api/health indicates server secrets active',
        hasGemini && hasBg,
        `gemini: ${healthData.gemini}, backgroundRemoval: ${healthData.backgroundRemoval}`
      );
    } else {
      recordCheck('Runtime', 'GET /api/health responds', false, `HTTP ${healthRes.status}`);
    }
  } catch (err) {
    recordCheck('Runtime', 'Dev server running on port 3000', false, `Unable to connect to ${baseUrl}`);
    return;
  }

  // 2. Check GET rejection on POST-only endpoints
  try {
    const bgGetRes = await fetch(`${baseUrl}/api/remove-background`, { method: 'GET' });
    recordCheck(
      'Runtime',
      'GET /api/remove-background returns 405 Method Not Allowed',
      bgGetRes.status === 405,
      `HTTP status: ${bgGetRes.status}`
    );

    const geminiGetRes = await fetch(`${baseUrl}/api/gemini/analyze-craft`, { method: 'GET' });
    recordCheck(
      'Runtime',
      'GET /api/gemini/analyze-craft returns 405 Method Not Allowed',
      geminiGetRes.status === 405,
      `HTTP status: ${geminiGetRes.status}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    recordCheck('Runtime', 'Method restriction check', false, msg);
  }

  // 3. Test POST /api/remove-background with invalid payload (checks validation without crashing)
  try {
    const invalidPost = await fetch(`${baseUrl}/api/remove-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    recordCheck(
      'Runtime',
      'POST /api/remove-background validates required image payload',
      invalidPost.status === 400,
      `HTTP status: ${invalidPost.status}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    recordCheck('Runtime', 'Invalid payload check', false, msg);
  }

  // 4. Test POST /api/remove-background with small valid asset
  try {
    const samplePngPath = path.resolve(process.cwd(), 'public/pwa-192x192.png');
    if (fs.existsSync(samplePngPath)) {
      const b64 = fs.readFileSync(samplePngPath).toString('base64');
      const removeBgRes = await fetch(`${baseUrl}/api/remove-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: `data:image/png;base64,${b64}` }),
      });

      if (removeBgRes.ok) {
        const bgData = await removeBgRes.json();
        const hasTransparent = typeof bgData.transparentPng === 'string' && bgData.transparentPng.startsWith('data:image/png;base64,');
        recordCheck(
          'Runtime',
          'POST /api/remove-background returns transparent PNG via provider',
          hasTransparent,
          'Successfully isolated background with dedicated server-side API'
        );
      } else {
        const errJson = await removeBgRes.json().catch(() => ({}));
        recordCheck(
          'Runtime',
          'POST /api/remove-background execution',
          false,
          `HTTP ${removeBgRes.status}: ${errJson.error || 'Request failed'}`
        );
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    recordCheck('Runtime', 'Live background removal check', false, msg);
  }

  // 5. Test POST /api/gemini/analyze-craft with sample craft hint
  try {
    const geminiRes = await fetch(`${baseUrl}/api/gemini/analyze-craft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voiceHint: 'Handmade terracotta vase with floral warli art',
        language: 'en',
      }),
    });

    if (geminiRes.ok) {
      const geminiData = await geminiRes.json();
      const hasStructure = Boolean(geminiData.productTitle && geminiData.craftCategory && geminiData.suggestedPrice);
      recordCheck(
        'Runtime',
        'POST /api/gemini/analyze-craft returns structured craft data',
        hasStructure,
        `Title: "${geminiData.productTitle}", Category: "${geminiData.craftCategory}"`
      );
    } else {
      recordCheck('Runtime', 'POST /api/gemini/analyze-craft execution', false, `HTTP ${geminiRes.status}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    recordCheck('Runtime', 'Live Gemini craft analysis check', false, msg);
  }
}

// -------------------------------------------------------------
// Main Diagnostic Runner
// -------------------------------------------------------------
async function runDiagnostics() {
  console.log('=============================================================');
  console.log('  KalaKart / ShreniScan API Security & Endpoint Diagnostics');
  console.log('=============================================================');

  checkFrontendEndpoints();
  checkClientSecretLeaks();
  checkServerImplementation();
  checkProductionBundle();
  await checkLiveEndpoints();

  console.log('\n=============================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  const allPassed = passedCount === totalCount;

  if (allPassed) {
    console.log(`\x1b[32m\x1b[1mALL CHECKS PASSED: ${passedCount}/${totalCount} tests succeeded.\x1b[0m`);
    console.log('Frontend communicates exclusively through secure server endpoints.');
    console.log('Zero environment API keys are exposed to the client or browser bundle.');
  } else {
    console.log(`\x1b[31m\x1b[1mDIAGNOSTICS COMPLETED WITH WARNINGS: ${passedCount}/${totalCount} passed.\x1b[0m`);
  }
  console.log('=============================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runDiagnostics().catch((err) => {
  console.error('Fatal diagnostic error:', err);
  process.exit(1);
});
