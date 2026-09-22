export type VerificationResult = {
  status: "verified" | "failed";
  referenceId: string;
  method: string;
  verifiedAt: string | null;
  displayName: string | null;
  reason?: string;
};

const DEMO_REFERENCE_PREFIX = "DEMO-EKYC";
const ALLOWED_DEMO_IDS = ["DEMO-ARTISAN-001", "DEMO-ARTISAN-002", "DEMO-ARTISAN-003"];

const FAILURE_REASONS = [
  "Verification service unavailable",
  "Details could not be verified",
  "Verification session expired",
];

export async function startVerification({
  data,
}: {
  data: { testId: string; consent: boolean };
}): Promise<VerificationResult> {
  const testId = String(data?.testId ?? "").trim().toUpperCase();
  if (!data?.consent) throw new Error("Consent is required to start verification.");
  if (!testId) throw new Error("Please enter the test verification ID.");

  const success = ALLOWED_DEMO_IDS.includes(testId);
  const referenceId = `${DEMO_REFERENCE_PREFIX}-${Date.now().toString(36).toUpperCase()}`;

  if (!success) {
    return {
      status: "failed",
      referenceId,
      method: "Aadhaar e-KYC Demo",
      verifiedAt: null,
      displayName: null,
      reason: FAILURE_REASONS[1],
    };
  }

  const verifiedAt = new Date().toISOString();
  return {
    status: "verified",
    referenceId,
    method: "Aadhaar e-KYC Demo",
    verifiedAt,
    displayName: "Demo Artisan",
  };
}

export async function checkVerificationStatus() {
  return {
    status: "verified" as const,
    method: "Aadhaar e-KYC Demo",
    verifiedAt: new Date().toISOString(),
  };
}

export async function getVerificationResult() {
  return {
    displayName: "Demo Artisan",
    status: "verified" as const,
    method: "Aadhaar e-KYC Demo",
    verifiedAt: new Date().toISOString(),
    referenceId: "DEMO-EKYC-DEFAULT",
  };
}

export async function skipVerification() {
  return { ok: true };
}
