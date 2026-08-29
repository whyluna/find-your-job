import { useEffect, useState } from "react";
import { Routes, Route } from "react-router";
import { SidebarLayout } from "@/components/SidebarLayout";
import { OnboardingGate } from "@/components/OnboardingGate";
import { PinGate } from "@/components/PinGate";
import { CommandPalette } from "@/components/CommandPalette";
import { CreateApplicationDialog } from "@/components/CreateApplicationDialog";
import DashboardPage from "@/pages/DashboardPage";
import ApplicationsPage from "@/pages/ApplicationsPage";
import ApplicationDetailPage from "@/pages/ApplicationDetailPage";
import ResumeLibraryPage from "@/pages/ResumeLibraryPage";
import CompaniesPage from "@/pages/CompaniesPage";
import SettingsPage from "@/pages/SettingsPage";
import StatsPage from "@/pages/StatsPage";
import CalendarPage from "@/pages/CalendarPage";
import ReviewPage from "@/pages/ReviewPage";
import OffersPage from "@/pages/OffersPage";

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <PinGate>
    <OnboardingGate>
      <SidebarLayout>
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
        </Routes>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onCreateApplication={() => setShowCreate(true)}
        />
        <CreateApplicationDialog open={showCreate} onClose={() => setShowCreate(false)} defaultBatch="FORMAL" />
      </SidebarLayout>
    </OnboardingGate>
    </PinGate>
  );
}
