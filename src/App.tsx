import { Routes, Route } from "react-router";
import { SidebarLayout } from "@/components/SidebarLayout";
import DashboardPage from "@/pages/DashboardPage";
import ApplicationsPage from "@/pages/ApplicationsPage";
import ResumeLibraryPage from "@/pages/ResumeLibraryPage";
import CompaniesPage from "@/pages/CompaniesPage";
import SettingsPage from "@/pages/SettingsPage";

export default function App() {
  return (
    <SidebarLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        <Route path="/resumes" element={<ResumeLibraryPage />} />
        <Route path="/companies" element={<CompaniesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </SidebarLayout>
  );
}
