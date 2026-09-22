import { useState, useEffect } from "react";
import { Download, Share, PlusSquare, X, CheckCircle2, Smartphone } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Check if running as standalone PWA
    const isStandaloneMode =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(isStandaloneMode);

    // Check if dismissed in this session
    const wasDismissed = sessionStorage.getItem("kalakart_pwa_dismissed") === "true";
    setDismissed(wasDismissed);

    // Check iOS Safari
    const ua = window.navigator.userAgent.toLowerCase();
    const isAppleMobile = /iphone|ipad|ipod/.test(ua);
    const isSafariBrowser = /safari/.test(ua) && !/crios|fxios|chrome/.test(ua);
    setIsIOS(isAppleMobile && isSafariBrowser);

    // Listen for native beforeinstallprompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
      setTimeout(() => setDismissed(true), 3000);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
      }
      setDeferredPrompt(null);
    } else if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("kalakart_pwa_dismissed", "true");
  };

  if (isStandalone || dismissed) {
    return null;
  }

  // Only show if prompt is available or it's iOS or user hasn't installed
  if (!deferredPrompt && !isIOS && !installed) {
    return null;
  }

  return (
    <div className="mx-4 my-2 overflow-hidden rounded-2xl border border-gold/40 bg-gradient-to-r from-[#fffbeb] to-[#fef3c7] p-3.5 shadow-card transition-all">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-warm text-white shadow-soft">
            {installed ? (
              <CheckCircle2 className="size-5 text-leaf" />
            ) : (
              <Smartphone className="size-5" />
            )}
          </div>
          <div>
            <p className="text-xs font-bold text-[#78350f]">
              {installed ? "ShreniKart Installed!" : "Install ShreniKart App"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {installed
                ? "Added to home screen for offline access"
                : "Work offline · Quick Shreni Scan · Instant access"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {!installed && (
            <button
              type="button"
              onClick={handleInstallClick}
              className="tap flex items-center gap-1.5 rounded-xl bg-[#b45309] px-3 py-1.5 text-xs font-bold text-white shadow-soft hover:bg-[#9a3412]"
            >
              <Download className="size-3.5" />
              <span>Install</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss banner"
            className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-black/5"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* iOS Safari step-by-step instructions drawer */}
      {showIOSGuide && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-white/80 p-3 text-xs text-[#78350f] backdrop-blur">
          <p className="font-semibold">How to install on iOS Safari:</p>
          <ol className="mt-1.5 space-y-1 text-[11px]">
            <li className="flex items-center gap-2">
              <span className="grid size-4 place-items-center rounded-full bg-amber-200 text-[9px] font-bold">1</span>
              <span>Tap the <strong>Share</strong> icon <Share className="inline size-3.5 text-blue-600" /> at bottom of Safari</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="grid size-4 place-items-center rounded-full bg-amber-200 text-[9px] font-bold">2</span>
              <span>Scroll down and tap <strong>Add to Home Screen</strong> <PlusSquare className="inline size-3.5" /></span>
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
