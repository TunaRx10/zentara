import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProspectsPage } from '@/pages/ProspectsPage';
import { ProspectDetailPage } from '@/pages/ProspectDetailPage';
import { CompaniesPage } from '@/pages/CompaniesPage';
import { CompanyDetailPage } from '@/pages/CompanyDetailPage';
import { ContactsPage } from '@/pages/ContactsPage';
import { CampaignsPage } from '@/pages/CampaignsPage';
import { MonitoringPage } from '@/pages/MonitoringPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { KnowledgePage } from '@/pages/KnowledgePage';
import { LandingPage } from '@/pages/LandingPage';
import { ChatPage } from '@/pages/ChatPage';
import { ContractsPage } from '@/pages/ContractsPage';
import { SiteDesignAuditPage } from '@/pages/SiteDesignAuditPage';
import { EmailsPage } from '@/pages/EmailsPage';
import { ZentaraOnePage } from '@/pages/ZentaraOnePage';
import { LazyChunkErrorBoundary } from '@/components/LazyChunkErrorBoundary';

const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);

/**
 * AuthedRoutes — les Routes seules, sans BrowserRouter.
 *
 * Round 142 — unification du moteur :
 *   /one (Moteur Zentara) est désormais l'UNIQUE page moteur : recherche
 *   unifiée (Companies/People/Local), analyses (jobs async + progression),
 *   résultats, emails, jobs et assistant. Les anciennes pages moteur
 *   (/intelligence, /ai, /leadflow, /search, /maps) redirigent vers /one
 *   pour que les anciens liens ne cassent pas.
 */
export function AuthedRoutes(): React.ReactElement {
  return (
    <Routes>
      {/* Public marketing landing — accessible sans auth. */}
      <Route path="/landing" element={<LandingPage />} />

      {/* Application principale — protégée par AppLayout (sidebar/topbar). */}
      <Route element={<AppLayout />}>
        <Route
          path="/"
          element={
            <LazyChunkErrorBoundary fallback={<DashboardFallback />}>
              <Suspense fallback={<DashboardFallback />}>
                <DashboardPage />
              </Suspense>
            </LazyChunkErrorBoundary>
          }
        />
        <Route path="/prospects" element={<ProspectsPage />} />
        <Route path="/prospects/:id" element={<ProspectDetailPage />} />
        <Route path="/companies" element={<CompaniesPage />} />
        <Route path="/companies/:companyId" element={<CompanyDetailPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/campaigns" element={<CampaignsPage />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/contracts" element={<ContractsPage />} />
        <Route path="/design-audit" element={<SiteDesignAuditPage />} />
        <Route path="/emails" element={<EmailsPage />} />
        <Route path="/settings" element={<SettingsPage />} />

        {/* Round 142 — Moteur UNIFIÉ (recherche + analyse + résultats + emails + assistant). */}
        <Route path="/one" element={<ZentaraOnePage />} />

        {/* Anciennes pages moteur → redirigées vers /one. */}
        <Route path="/intelligence" element={<Navigate to="/one" replace />} />
        <Route path="/ai" element={<Navigate to="/one" replace />} />
        <Route path="/leadflow" element={<Navigate to="/one" replace />} />
        <Route path="/search" element={<Navigate to="/one" replace />} />
        <Route path="/maps" element={<Navigate to="/one" replace />} />
      </Route>
    </Routes>
  );
}

/**
 * DashboardFallback — Suspense simple pendant le lazy-load de DashboardPage.
 */
function DashboardFallback(): React.ReactElement {
  return (
    <div className="space-y-4 p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-32 rounded-xl border border-border/60 bg-card/60 animate-pulse"
          />
        ))}
      </div>
      <div className="h-64 rounded-xl border border-border/60 bg-card/40 animate-pulse" />
      <div className="h-48 rounded-xl border border-border/60 bg-card/40 animate-pulse" />
    </div>
  );
}

/**
 * AppRouter — version COMPOSITE : BrowserRouter + AuthedRoutes.
 */
export function AppRouter(): React.ReactElement {
  return (
    <BrowserRouter>
      <AuthedRoutes />
    </BrowserRouter>
  );
}
