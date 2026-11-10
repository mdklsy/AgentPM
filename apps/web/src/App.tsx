import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { onUnauthorized } from './api/client.js';
import { useAuth } from './auth.js';
import { Spinner } from './components/ui.js';
import { ActivityPage } from './pages/ActivityPage.js';
import { AgentsPage } from './pages/AgentsPage.js';
import { ApprovalsPage } from './pages/ApprovalsPage.js';
import { BacklogPage } from './pages/BacklogPage.js';
import { BoardPage } from './pages/BoardPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { MembersPage } from './pages/MembersPage.js';
import { MyWorkPage } from './pages/MyWorkPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { ProjectLayout } from './pages/ProjectLayout.js';
import { ProjectsPage } from './pages/ProjectsPage.js';
import { RegressionsPage } from './pages/RegressionsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { SprintPage } from './pages/SprintPage.js';
import { TeamPage } from './pages/TeamPage.js';
import { WebhooksPage } from './pages/WebhooksPage.js';
import { MonitoringPage } from './pages/MonitoringPage.js';

export function App() {
  const { me, loading, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    onUnauthorized(() => navigate('/login'));
  }, [navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="AgentPM 启动中…" />
      </div>
    );
  }

  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/" element={<ProjectsPage />} />
      <Route path="/team" element={<TeamPage />} />
      <Route path="/my" element={<MyWorkPage />} />
      <Route path="/p/:key" element={<ProjectLayout />}>
        <Route index element={<BoardPage />} />
        <Route path="sprint" element={<SprintPage />} />
        <Route path="backlog" element={<BacklogPage />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="regressions" element={<RegressionsPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="webhooks" element={<WebhooksPage />} />
        <Route path="monitoring" element={<MonitoringPage />} />
      </Route>
      <Route
        path="*"
        element={
          <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-slate-400">
            <p>页面不存在</p>
            <button className="text-indigo-600 underline" onClick={() => void logout()}>
              退出登录
            </button>
          </div>
        }
      />
    </Routes>
  );
}
