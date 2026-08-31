import { lazy, Suspense, useEffect, useState } from "react";
import { Routes, Route } from "react-router";
import { useNavigate } from "react-router";
import { SidebarLayout } from "@/components/SidebarLayout";
import { OnboardingGate } from "@/components/OnboardingGate";
import { CommandPalette } from "@/components/CommandPalette";
import { CreateApplicationDialog } from "@/components/CreateApplicationDialog";
import { ToastViewport } from "@/components/ToastViewport";

const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const ApplicationsPage = lazy(() => import("@/pages/ApplicationsPage"));
const ApplicationDetailPage = lazy(() => import("@/pages/ApplicationDetailPage"));
const ResumeLibraryPage = lazy(() => import("@/pages/ResumeLibraryPage"));
const CompaniesPage = lazy(() => import("@/pages/CompaniesPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const StatsPage = lazy(() => import("@/pages/StatsPage"));
const CalendarPage = lazy(() => import("@/pages/CalendarPage"));
const ReviewPage = lazy(() => import("@/pages/ReviewPage"));
const OffersPage = lazy(() => import("@/pages/OffersPage"));

export default function App() {
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setShowCreate(true);
      } else if (e.metaKey && e.key === ",") {
        e.preventDefault();
        navigate("/settings");
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        const search = document.querySelector<HTMLInputElement>("[data-global-search]");
        if (search) {
          e.preventDefault();
          search.focus();
          search.select();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <OnboardingGate>
      <SidebarLayout>
        <Suspense fallback={<div className="flex h-full items-center justify-center text-[13px] text-[var(--fyj-tertiary)]">正在打开…</div>}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/applications/:id" element={<ApplicationDetailPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/offers" element={<OffersPage />} />
            <Route path="/resumes" element={<ResumeLibraryPage />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<div className="p-8 text-[13px] text-[var(--fyj-secondary)]">页面不存在</div>} />
          </Routes>
        </Suspense>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onCreateApplication={() => setShowCreate(true)}
        />
        <CreateApplicationDialog open={showCreate} onClose={() => setShowCreate(false)} defaultBatch="FORMAL" />
        <ToastViewport />
      </SidebarLayout>
    </OnboardingGate>
  );
}
