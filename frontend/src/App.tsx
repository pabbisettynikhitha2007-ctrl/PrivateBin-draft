import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useTranslation } from "react-i18next";
import CreatePage from "./CreatePage";
import ViewPage from "./ViewPage";
import ManagePage from "./ManagePage";
import LanguageSelector from "./LanguageSelector";
import "./App.css";

export default function App() {
  const { t } = useTranslation();
  return (
    <BrowserRouter>
      <div className="app-shell">
        <header>
          <div className="header-inner">
            <div className="header-text">
              <h1>{t("app.title")}</h1>
              <p className="tagline">{t("app.tagline")}</p>
            </div>
            <LanguageSelector />
          </div>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<CreatePage />} />
            <Route path="/view/:id" element={<ViewPage />} />
            <Route path="/manage/:id" element={<ManagePage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
