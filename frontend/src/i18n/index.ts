import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import pt from "./locales/pt.json";
import it from "./locales/it.json";
import ru from "./locales/ru.json";
import ar from "./locales/ar.json";
import zh from "./locales/zh.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import hi from "./locales/hi.json";
import bn from "./locales/bn.json";
import te from "./locales/te.json";
import ta from "./locales/ta.json";
import mr from "./locales/mr.json";
import gu from "./locales/gu.json";
import kn from "./locales/kn.json";
import ml from "./locales/ml.json";
import pa from "./locales/pa.json";
import or_ from "./locales/or.json";
import ur from "./locales/ur.json";

const savedLang = localStorage.getItem("ss_lang");
const browserLang = navigator.language.split("-")[0];

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      pt: { translation: pt },
      it: { translation: it },
      ru: { translation: ru },
      ar: { translation: ar },
      zh: { translation: zh },
      ja: { translation: ja },
      ko: { translation: ko },
      hi: { translation: hi },
      bn: { translation: bn },
      te: { translation: te },
      ta: { translation: ta },
      mr: { translation: mr },
      gu: { translation: gu },
      kn: { translation: kn },
      ml: { translation: ml },
      pa: { translation: pa },
      or: { translation: or_ },
      ur: { translation: ur },
    },
    lng: savedLang || browserLang || "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });

export default i18n;
