/**
 * Demo OTP login. No real SMS is sent and no OTP is stored in the database.
 * The code is a fixed, clearly-labelled demo code.
 */
const DEMO_CODE = "123456";

export async function requestDemoOtp({ data }: { data: { mobile: string } }) {
  const mobile = String(data?.mobile ?? "").replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(mobile)) throw new Error("Please enter a valid 10-digit mobile number.");
  return {
    sent: true,
    registered: true,
    demoCode: DEMO_CODE,
    demo: true,
  };
}

export async function verifyDemoOtp({ data }: { data: { mobile: string; code: string } }) {
  const mobile = String(data?.mobile ?? "").replace(/\D/g, "").slice(-10);
  const code = String(data?.code ?? "").replace(/\D/g, "");
  if (!/^[6-9]\d{9}$/.test(mobile)) throw new Error("Please enter a valid 10-digit mobile number.");
  if (code.length !== 6) throw new Error("Please enter the 6-digit code.");
  if (code !== DEMO_CODE) {
    return { ok: false as const, error: "That code is not correct. Use demo code 123456." };
  }

  return { ok: true as const, tokenHash: "demo_token_hash" };
}
