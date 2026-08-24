import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";

const INTERNATIONAL = [
  { code: "en", name: "English",    native: "English"    },
  { code: "es", name: "Spanish",    native: "Español"    },
  { code: "fr", name: "French",     native: "Français"   },
  { code: "de", name: "German",     native: "Deutsch"    },
  { code: "pt", name: "Portuguese", native: "Português"  },
  { code: "it", name: "Italian",    native: "Italiano"   },
  { code: "ru", name: "Russian",    native: "Русский"    },
  { code: "ar", name: "Arabic",     native: "العربية"    },
  { code: "zh", name: "Chinese",    native: "中文"        },
  { code: "ja", name: "Japanese",   native: "日本語"      },
  { code: "ko", name: "Korean",     native: "한국어"      },
];

const INDIAN = [
  { code: "hi", name: "Hindi",     native: "हिन्दी"    },
  { code: "bn", name: "Bengali",   native: "বাংলা"      },
  { code: "te", name: "Telugu",    native: "తెలుగు"     },
  { code: "ta", name: "Tamil",     native: "தமிழ்"      },
  { code: "mr", name: "Marathi",   native: "मराठी"      },
  { code: "gu", name: "Gujarati",  native: "ગુજરાતી"    },
  { code: "kn", name: "Kannada",   native: "ಕನ್ನಡ"      },
  { code: "ml", name: "Malayalam", native: "മലയാളം"     },
  { code: "pa", name: "Punjabi",   native: "ਪੰਜਾਬੀ"    },
  { code: "or", name: "Odia",      native: "ଓଡ଼ିଆ"      },
  { code: "ur", name: "Urdu",      native: "اردو"       },
];

const RTL_LANGS = new Set(["ar", "ur"]);
const ALL_LANGS = [...INTERNATIONAL, ...INDIAN];

function getLangInfo(code: string) {
  return ALL_LANGS.find((l) => l.code === code) ?? INTERNATIONAL[0];
}

export default function LanguageSelector() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = getLangInfo(i18n.language);

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function selectLang(code: string) {
    i18n.changeLanguage(code);
    localStorage.setItem("ss_lang", code);
    // Apply RTL/LTR to document
    document.documentElement.setAttribute("dir", RTL_LANGS.has(code) ? "rtl" : "ltr");
    document.documentElement.setAttribute("lang", code);
    setOpen(false);
  }

  // Apply RTL on mount for currently saved lang
  useEffect(() => {
    const lang = localStorage.getItem("ss_lang") ?? i18n.language ?? "en";
    document.documentElement.setAttribute("dir", RTL_LANGS.has(lang) ? "rtl" : "ltr");
    document.documentElement.setAttribute("lang", lang);
  }, []);

  return (
    <div className="lang-selector" ref={ref}>
      <button
        className="lang-trigger"
        onClick={() => setOpen((v) => !v)}
        title={t("lang.label")}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="lang-trigger-icon">🌐</span>
        <span className="lang-trigger-name">{current.native}</span>
        <span className="lang-trigger-caret">{open ? "▲" : "▾"}</span>
      </button>

      {open && (
        <div className="lang-dropdown" role="listbox">
          <div className="lang-group-label">{t("lang.international")}</div>
          {INTERNATIONAL.map((lang) => (
            <button
              key={lang.code}
              role="option"
              aria-selected={lang.code === i18n.language}
              className={`lang-option ${lang.code === i18n.language ? "active" : ""}`}
              onClick={() => selectLang(lang.code)}
            >
              <span className="lang-native">{lang.native}</span>
              <span className="lang-english">{lang.name}</span>
            </button>
          ))}

          <div className="lang-group-label lang-group-label--indian">{t("lang.indian")}</div>
          {INDIAN.map((lang) => (
            <button
              key={lang.code}
              role="option"
              aria-selected={lang.code === i18n.language}
              className={`lang-option ${lang.code === i18n.language ? "active" : ""}`}
              onClick={() => selectLang(lang.code)}
            >
              <span className="lang-native">{lang.native}</span>
              <span className="lang-english">{lang.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
