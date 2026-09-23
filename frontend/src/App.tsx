/**
 * 路由表：
 *   /            下載器（首頁）
 *   /library     媒體庫（資料夾 + 檔案列表）
 *   /media/:id   媒體詳細頁（播放器 + 逐字稿）
 *   /models      模型（Whisper 模型下載狀態、預先下載、刪除）
 * AppProvider 提供全域 toast 與任務輪詢，Layout 是共用外框（header + 動效）。
 */
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AppProvider } from "./context/AppContext";
import { DashboardPage } from "./pages/DashboardPage";
import { DownloaderPage } from "./pages/DownloaderPage";
import { MediaDetailPage } from "./pages/MediaDetailPage";
import { ModelsPage } from "./pages/ModelsPage";

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<DownloaderPage />} />
            <Route path="/library" element={<DashboardPage />} />
            <Route path="/media/:id" element={<MediaDetailPage />} />
            <Route path="/models" element={<ModelsPage />} />
          </Routes>
        </Layout>
      </AppProvider>
    </BrowserRouter>
  );
}
