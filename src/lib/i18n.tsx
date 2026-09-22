import React, { createContext, useContext, useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { cn } from "./utils";

export type Lang = "en" | "hi" | "mr";

export interface LanguageOption {
  code: Lang;
  name: string;
  native: string;
}

export const languageOptions: LanguageOption[] = [
  { code: "en", name: "English", native: "English" },
  { code: "hi", name: "Hindi", native: "हिंदी" },
  { code: "mr", name: "Marathi", native: "मराठी" },
];

const translations: Record<Lang, Record<string, string>> = {
  en: {
    brand: "ShreniKart Artisans",
    tagline: "Connecting authentic Indian craftspeople directly with genuine patrons nationwide.",
    login: "Log In",
    register: "Register as Artisan",
    secureSimple: "Secure & Simple",
    multilingual: "Available in 3 Languages",
    designedForArtisans: "Built for Indian Craftspeople",
    welcomeBack: "Welcome Back",
    password: "Password",
    mobile: "Mobile Number",
    forgotPassword: "Forgot password?",
    continueWithOtp: "Continue with Demo OTP",
    noAccount: "Don't have an account? Register",
    haveAccount: "Already have an account? Log In",
    errMobile: "Please enter a valid 10-digit mobile number",
    errPassword: "Password must be at least 6 characters",
    errName: "Please enter your full name",
    errGeneric: "Something went wrong. Please try again.",
    errSession: "Session expired. Please log in again.",
    errService: "Verification service encountered an error. Please try again.",
    okLogin: "Logged in successfully!",
    okRegister: "Your artisan account is ready. Start adding crafts, taking orders and replying to buyers.",
    basicInfo: "Basic Details",
    artisanInfo: "Artisan Profile",
    verifyIdentity: "Verify Identity",
    fullName: "Full Name",
    email: "Email Address (Optional)",
    preferredLanguage: "Preferred Language",
    continue: "Continue",
    artisanName: "Workshop / Artisan Brand Name",
    craftCategory: "Primary Craft Category",
    experience: "Years of Experience",
    village: "Village / Town",
    district: "District",
    state: "State",
    verified: "Verified Artisan",
    startVerification: "Start Demo Verification",
    verifyLater: "Verify Later",
    canvas: "Canvas",
    "2d": "2d",
  },
  hi: {
    brand: "श्रेणीकार्ट कारीगर",
    tagline: "भारतीय कारीगरों को सीधे देश भर के खरीदारों से जोड़ने वाला मंच।",
    login: "लॉग इन करें",
    register: "कारीगर के रूप में पंजीकरण करें",
    secureSimple: "सुरक्षित और आसान",
    multilingual: "3 भाषाओं में उपलब्ध",
    designedForArtisans: "कारीगरों के लिए विशेष रूप से निर्मित",
    welcomeBack: "वापसी पर स्वागत है",
    password: "पासवर्ड",
    mobile: "मोबाइल नंबर",
    forgotPassword: "पासवर्ड भूल गए?",
    continueWithOtp: "डेमो ओटीपी से जारी रखें",
    noAccount: "खाता नहीं है? पंजीकरण करें",
    haveAccount: "पहले से खाता है? लॉग इन करें",
    errMobile: "कृपया 10 अंकों का मान्य मोबाइल नंबर दर्ज करें",
    errPassword: "पासवर्ड कम से कम 6 अक्षरों का होना चाहिए",
    errName: "कृपया अपना पूरा नाम दर्ज करें",
    errGeneric: "कुछ गलत हो गया। कृपया पुन: प्रयास करें।",
    errSession: "सत्र समाप्त हो गया। कृपया दोबारा लॉग इन करें।",
    errService: "सत्यापन सेवा में त्रुटि हुई। कृपया पुनः प्रयास करें।",
    okLogin: "सफलतापूर्वक लॉग इन किया गया!",
    okRegister: "आपका कारीगर खाता तैयार है। शिल्प जोड़ें, ऑर्डर प्राप्त करें।",
    basicInfo: "मूल विवरण",
    artisanInfo: "कारीगर प्रोफाइल",
    verifyIdentity: "पहचान सत्यापित करें",
    fullName: "पूरा नाम",
    email: "ईमेल (वैकल्पिक)",
    preferredLanguage: "पसंदीदा भाषा",
    continue: "आगे बढ़ें",
    artisanName: "कार्यशाला / ब्रांड का नाम",
    craftCategory: "शिल्प की श्रेणी",
    experience: "अनुभव (वर्षों में)",
    village: "गाँव / शहर",
    district: "ज़िला",
    state: "राज्य",
    verified: "सत्यापित कारीगर",
    startVerification: "डेमो सत्यापन शुरू करें",
    verifyLater: "बाद में सत्यापित करें",
    canvas: "कैनवास",
    "2d": "2d",
  },
  mr: {
    brand: "श्रेणीकार्ट कारागीर",
    tagline: "भारतीय कारागिरांना थेट देशभरातील ग्राहकांशी जोडणारे व्यासपीठ.",
    login: "लॉग इन करा",
    register: "कारागीर म्हणून नोंदणी करा",
    secureSimple: "सुरक्षित व सोपे",
    multilingual: "३ भाषांमध्ये उपलब्ध",
    designedForArtisans: "कारागिरांसाठी खास बनवलेले",
    welcomeBack: "पुन्हा स्वागत आहे",
    password: "पासवर्ड",
    mobile: "मोबाइल नंबर",
    forgotPassword: "पासवर्ड विसरलात?",
    continueWithOtp: "डेमो ओटीपीने पुढे जा",
    noAccount: "खाते नाही? नोंदणी करा",
    haveAccount: "आधीच खाते आहे? लॉग इन करा",
    errMobile: "कृपया वैध १० अंकी मोबाइल क्रमांक प्रविष्ट करा",
    errPassword: "पासवर्ड किमान ६ अक्षरांचा असावा",
    errName: "कृपया तुमचे पूर्ण नाव प्रविष्ट करा",
    errGeneric: "काहीतरी चूक झाली. कृपया पुन्हा प्रयत्न करा.",
    errSession: "सत्र कालबाह्य झाले. कृपया पुन्हा लॉग इन करा.",
    errService: "पडताळणी सेवेत त्रुटी आढळली. कृपया पुन्हा प्रयत्न करा.",
    okLogin: "यशस्वीरित्या लॉग इन झाले!",
    okRegister: "तुमचे कारागीर खाते तयार आहे. हस्तकला जोडा आणि विक्री सुरू करा.",
    basicInfo: "मूलभूत माहिती",
    artisanInfo: "कारागीर प्रोफाइल",
    verifyIdentity: "ओळख पडताळणी",
    fullName: "पूर्ण नाव",
    email: "ईमेल (पर्यायी)",
    preferredLanguage: "पसंतीची भाषा",
    continue: "पुढे चला",
    artisanName: "कार्यशाळा / ब्रँड नाव",
    craftCategory: "हस्तकला प्रकार",
    experience: "अनुभव (वर्षे)",
    village: "गाव / शहर",
    district: "जिल्हा",
    state: "राज्य",
    verified: "पडताळणी झालेले कारागीर",
    startVerification: "डेमो पडताळणी सुरू करा",
    verifyLater: "नंतर पडताळणी करा",
    canvas: "कॅनव्हास",
    "2d": "2d",
  },
};

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("kalakart_lang") as Lang;
      if (saved && (saved === "en" || saved === "hi" || saved === "mr")) {
        return saved;
      }
    }
    return "en";
  });

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    if (typeof window !== "undefined") {
      localStorage.setItem("kalakart_lang", newLang);
    }
  };

  const t = (key: string): string => {
    return translations[lang]?.[key] ?? translations.en[key] ?? key;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextType {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      lang: "en",
      setLang: () => {},
      t: (key: string) => translations.en[key] ?? key,
    };
  }
  return ctx;
}

export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setLang } = useI18n();

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border/40 bg-card/80 p-1 backdrop-blur-md shadow-xs",
        className
      )}
    >
      <Languages className="ml-1.5 size-3.5 text-muted-foreground" />
      {languageOptions.map((opt) => (
        <button
          key={opt.code}
          type="button"
          onClick={() => setLang(opt.code)}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-semibold transition-all",
            lang === opt.code
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.native}
        </button>
      ))}
    </div>
  );
}
