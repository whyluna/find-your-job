import { Routes, Route } from "react-router";
import { SidebarLayout } from "@/components/SidebarLayout";
import { OnboardingGate } from "@/components/OnboardingGate";
import DashboardPage from "@/pages/DashboardPage";
import ApplicationsPage from "@/pages/ApplicationsPage";
import ApplicationDetailPage from "@/pages/ApplicationDetailPage";
import ResumeLibraryPage from "@/pages/ResumeLibraryPage";
import CompaniesPage from "@/pages/CompaniesPage";
import SettingsPage from "@/pages/SettingsPage";

export default function App() {
  return (
    <OnboardingGate>
      <SidebarLayout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/applications/:id" element={<ApplicationDetailPage />} />
          <Route path="/resumes" element={<ResumeLibraryPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </SidebarLayout>
    </OnboardingGate>
  );
}
