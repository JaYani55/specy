import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { DataProvider } from "./contexts/DataContext";
import { Toaster } from "./components/ui/sonner";
import { LoadingState } from "./components/ui/LoadingState";


// Import your pages
import Login from "./pages/Login";
import Events from "./pages/Events";
import Calendar from "./pages/Calendar";
import EventList from "./pages/List";
import CreateEvent from "./pages/CreateEvent";
import EventDetail from "./pages/EventDetail";
import EditEvent from "./pages/EditEvent";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import Me from "./pages/Me";
import ProductDetail from "./pages/ProductDetail";
import NotFound from "./pages/NotFound";
import TestLoader from "./pages/TestLoader";
import Info from "./pages/Info";
import PageBuilder from "./pages/PageBuilder";
import Pages from "./pages/Pages";
import PagesSchemaDetail from "./pages/PagesSchemaDetail";
import SchemaEditor from "./pages/SchemaEditor";
import Forms from "./pages/Forms";
import FormEditor from "./pages/FormEditor";
import FormAnswers from "./pages/FormAnswers";
import FormSharePage from "./pages/FormSharePage";
import PollResultsPage from "./pages/PollResultsPage";
import Objects from "./pages/Objects";
import ObjectEditor from "./pages/ObjectEditor";
import ObjectSharePage from "./pages/ObjectSharePage";
import Specs from "./pages/Specs";
import SpecEditor from "./pages/SpecEditor";

// Import components
import Layout from "./components/layout/Layout";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import { FloatingBugButton } from "./components/bugreporting/FloatingBugButton";
import { FloatingFeedbackButton } from "./components/feedback/FloatingFeedbackButton";

// Import Verwaltung components
import Verwaltung from "./pages/Verwaltung";
import VerwaltungAddMentor from "./pages/VerwaltungAddMentor";
import VerwaltungAllMentors from "./pages/VerwaltungAllMentors";
import VerwaltungAllProducts from "./pages/VerwaltungAllProducts";
import VerwaltungCreateProduct from "./pages/VerwaltungCreateProduct";
import VerwaltungMentorGroups from "./pages/VerwaltungMentorGroups";
import VerwaltungMentorGiveTraits from "./pages/VerwaltungMentorGiveTraits";
import VerwaltungAccounts from "./pages/VerwaltungAccounts";
import VerwaltungConnections from "./pages/VerwaltungConnections";
import VerwaltungApi from "./pages/VerwaltungApi";
import VerwaltungBranding from "./pages/VerwaltungBranding";
import Plugins from "./pages/Plugins";
import { getDefaultLandingPath, getStoredSetting, resolveDefaultLandingView } from './services/defaultLandingService';

// Plugin loader — provides build-time routes from installed plugins
import { getPluginRoutes } from "./plugins/loader";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      retry: false,
    },
  },
});

// Create a new component for the root route
const RootRoute = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    const loadDefaultView = async () => {
      if (user) {
        const storedDefaultView = getStoredSetting(user.id, 'default_view', '');
        const resolvedDefaultView = await resolveDefaultLandingView(storedDefaultView, user.roles);
        const resolvedPath = await getDefaultLandingPath(resolvedDefaultView, user.roles);

        navigate(resolvedPath, { replace: true });
      }
      setIsLoading(false);
    };
    
    loadDefaultView();
  }, [user, navigate]);
  
  if (isLoading) {
    return <LoadingState fullHeight={true} />;
  }
  
  return <Navigate to="/events" replace />;
};

const LegacySpecDetailRedirect = () => {
  const { specSlug } = useParams<{ specSlug: string }>();
  return <Navigate to={specSlug ? `/mcp/${specSlug}` : '/mcp'} replace />;
};

// Add this component to update document language
const DocumentLanguageUpdater = () => {
  const { language } = useTheme();
  
  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'de';
    document.title = 'ServiceCMS';
  }, [language]);
  
  return null;
};

// Content component must be used inside Router
const AppContent = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingState fullHeight={true} />;
  }

  return (
    <>
      <DocumentLanguageUpdater />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RootRoute />} />
        
        {/* Wrap all protected routes with Layout */}
        <Route element={<Layout />}>
          <Route 
            path="/events" 
            element={
              <ProtectedRoute>
                <Events />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/calendar" 
            element={
              <ProtectedRoute>
                <Calendar />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/list" 
            element={
              <ProtectedRoute>
                <EventList />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/create-event" 
            element={
              <ProtectedRoute>
                <CreateEvent />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/events/:id" 
            element={
              <ProtectedRoute>
                <EventDetail />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/edit-event/:id" 
            element={
              <ProtectedRoute>
                <EditEvent />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/profile" 
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/profile/:userId" 
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/settings" 
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/me" 
            element={
              <ProtectedRoute>
                <Me />
              </ProtectedRoute>
            }
             
          />
          <Route
            path="/info"
            element={
              <ProtectedRoute>
                <Info />
              </ProtectedRoute>
            }
          />
          <Route 
            path="/pagebuilder/:id" 
            element={
              <ProtectedRoute>
                <PageBuilder />
              </ProtectedRoute>
            } 
          />

          {/* Pages Routes */}
          <Route path="/pages" element={<ProtectedRoute requiredRole="user"><Pages /></ProtectedRoute>} />
          <Route path="/pages/schema/new" element={<ProtectedRoute requiredRole="user"><SchemaEditor /></ProtectedRoute>} />
          <Route path="/pages/schema/:schemaSlug" element={<ProtectedRoute requiredRole="user"><PagesSchemaDetail /></ProtectedRoute>} />
          <Route path="/pages/schema/:schemaSlug/settings" element={<ProtectedRoute requiredRole="user"><SchemaEditor /></ProtectedRoute>} />
          <Route path="/pages/schema/:schemaSlug/new" element={<ProtectedRoute requiredRole="user"><PageBuilder /></ProtectedRoute>} />
          <Route path="/pages/schema/:schemaSlug/edit/:pageId" element={<ProtectedRoute requiredRole="user"><PageBuilder /></ProtectedRoute>} />

          <Route path="/forms" element={<ProtectedRoute requiredRole="user"><Forms /></ProtectedRoute>} />
          <Route path="/forms/new" element={<ProtectedRoute requiredRole="user"><FormEditor /></ProtectedRoute>} />
          <Route path="/forms/:formId" element={<ProtectedRoute requiredRole="user"><FormEditor /></ProtectedRoute>} />
          <Route path="/forms/:formId/answers" element={<ProtectedRoute requiredRole="user"><FormAnswers /></ProtectedRoute>} />

          <Route path="/objects" element={<ProtectedRoute requiredRole="user"><Objects /></ProtectedRoute>} />
          <Route path="/objects/new" element={<ProtectedRoute requiredRole="user"><ObjectEditor /></ProtectedRoute>} />
          <Route path="/objects/:objectId" element={<ProtectedRoute requiredRole="user"><ObjectEditor /></ProtectedRoute>} />
          <Route path="/mcp" element={<ProtectedRoute requiredRole="user"><Specs /></ProtectedRoute>} />
          <Route path="/mcp/new" element={<ProtectedRoute requiredRole="user"><SpecEditor /></ProtectedRoute>} />
          <Route path="/mcp/:specSlug" element={<ProtectedRoute requiredRole="user"><SpecEditor /></ProtectedRoute>} />
          <Route path="/specs" element={<Navigate to="/mcp" replace />} />
          <Route path="/specs/new" element={<Navigate to="/mcp/new" replace />} />
          <Route path="/specs/:specSlug" element={<LegacySpecDetailRedirect />} />

          {/* Admin Routes */}
          <Route path="/admin" element={<ProtectedRoute requiredRole="user"><Verwaltung /></ProtectedRoute>} />
          <Route path="/admin/accounts" element={<ProtectedRoute requiredRole="admin"><VerwaltungAccounts /></ProtectedRoute>} />
          <Route path="/admin/connections" element={<ProtectedRoute requiredRole="super-admin"><VerwaltungConnections /></ProtectedRoute>} />
          <Route path="/admin/api" element={<ProtectedRoute requiredRole="super-admin"><VerwaltungApi /></ProtectedRoute>} />
          <Route path="/admin/branding" element={<ProtectedRoute requiredRole="super-admin"><VerwaltungBranding /></ProtectedRoute>} />
          <Route path="/admin/add-mentor" element={<ProtectedRoute requiredRole="user"><VerwaltungAddMentor /></ProtectedRoute>} />
          <Route path="/admin/all-mentors" element={<ProtectedRoute requiredRole="user"><VerwaltungAllMentors /></ProtectedRoute>} />
          <Route path="/admin/all-products" element={<ProtectedRoute requiredRole="user"><VerwaltungAllProducts /></ProtectedRoute>} />
          <Route path="/admin/create-product" element={<ProtectedRoute requiredRole="user"><VerwaltungCreateProduct /></ProtectedRoute>} />
          <Route 
            path="/admin/product/:productId" 
            element={
              <ProtectedRoute>
                <ProductDetail />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/trait" 
            element={
              <ProtectedRoute>
                <VerwaltungMentorGroups />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/traitsmentorassign" 
            element={
              <ProtectedRoute>
                <VerwaltungMentorGiveTraits />
              </ProtectedRoute>
            } 
          />
          {/* Plugins */}
          <Route path="/plugins" element={<ProtectedRoute requiredRole="admin"><Plugins /></ProtectedRoute>} />

          {/* Dynamic plugin routes (build-time, from src/plugins/registry.ts) */}
          {getPluginRoutes(user?.roles ?? []).map((r) => (
            <Route
              key={r.path}
              path={r.path}
              element={
                <ProtectedRoute requiredRole={r.requiredRole}>
                  <r.component />
                </ProtectedRoute>
              }
            />
          ))}

          <Route path="/test-loader" element={<ProtectedRoute><TestLoader /></ProtectedRoute>} />
        </Route>
        
        {/* Long Share Routes (for backward compatibility) */}
        <Route path="/forms/share/:tenantName/:formShareSlug" element={<FormSharePage />} />
        <Route path="/forms/share/:tenantName/:formShareSlug/results" element={<PollResultsPage />} />
        <Route path="/objects/share/:tenantName/:objectShareSlug" element={<ObjectSharePage />} />
        
        {/* Short Share Routes (New Default) */}
        <Route path="/s/:tenantName/:formShareSlug" element={<FormSharePage />} />
        <Route path="/s/:tenantName/:formShareSlug/results" element={<PollResultsPage />} />
        <Route path="/o/:tenantName/:objectShareSlug" element={<ObjectSharePage />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
      
      {/* <FloatingBugButton /> */}
      <FloatingFeedbackButton />
      <Toaster />
    </>
  );
};

const App = () => {
  useEffect(() => {
    const originalConsoleError = console.error;
    console.error = (...args) => {
      originalConsoleError.apply(console, args);
    };

    window.addEventListener('error', (event) => {
      const errorRegion = document.createElement('div');
      errorRegion.setAttribute('role', 'alert');
      errorRegion.setAttribute('aria-live', 'assertive');
      errorRegion.className = 'sr-only';
      errorRegion.textContent = 'An error occurred. Please refresh the page or contact support.';
      document.body.appendChild(errorRegion);
      
      setTimeout(() => {
        document.body.removeChild(errorRegion);
      }, 5000);
    });

    return () => {
      // Cleanup code
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <DataProvider>
              <AppContent />
            </DataProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
