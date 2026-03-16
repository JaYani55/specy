import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
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
import Plugins from "./pages/Plugins";

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
        console.log("[DEBUG] RootRoute: Redirecting user to events", user.id);
        navigate('/events', { replace: true });
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
          <Route path="/pages" element={<ProtectedRoute requiredRole="staff"><Pages /></ProtectedRoute>} />
          <Route path="/pages/schema/new" element={<ProtectedRoute requiredRole="staff"><SchemaEditor /></ProtectedRoute>} />
          <Route path="/pages/schema/:schemaSlug" element={<ProtectedRoute requiredRole="staff"><PagesSchemaDetail /></ProtectedRoute>} />
          <Route path="/pages/schema/:schemaSlug/settings" element={<ProtectedRoute requiredRole="staff"><SchemaEditor /></ProtectedRoute>} />
          <Route path="/pages/schema/:schemaSlug/new" element={<ProtectedRoute requiredRole="staff"><PageBuilder /></ProtectedRoute>} />
          <Route path="/pages/schema/:schemaSlug/edit/:pageId" element={<ProtectedRoute requiredRole="staff"><PageBuilder /></ProtectedRoute>} />

          {/* Verwaltung Routes */}
          <Route path="/verwaltung" element={<ProtectedRoute requiredRole="staff"><Verwaltung /></ProtectedRoute>} />
          <Route path="/verwaltung/accounts" element={<ProtectedRoute requiredRole="admin"><VerwaltungAccounts /></ProtectedRoute>} />
          <Route path="/verwaltung/connections" element={<ProtectedRoute requiredRole="admin"><VerwaltungConnections /></ProtectedRoute>} />
          <Route path="/verwaltung/add-mentor" element={<ProtectedRoute requiredRole="staff"><VerwaltungAddMentor /></ProtectedRoute>} />
          <Route path="/verwaltung/all-mentors" element={<ProtectedRoute requiredRole="staff"><VerwaltungAllMentors /></ProtectedRoute>} />
          <Route path="/verwaltung/all-products" element={<ProtectedRoute requiredRole="staff"><VerwaltungAllProducts /></ProtectedRoute>} />
          <Route path="/verwaltung/create-product" element={<ProtectedRoute requiredRole="staff"><VerwaltungCreateProduct /></ProtectedRoute>} />
          <Route 
            path="/verwaltung/product/:productId" 
            element={
              <ProtectedRoute>
                <ProductDetail />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/verwaltung/trait" 
            element={
              <ProtectedRoute>
                <VerwaltungMentorGroups />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/verwaltung/traitsmentorassign" 
            element={
              <ProtectedRoute>
                <VerwaltungMentorGiveTraits />
              </ProtectedRoute>
            } 
          />
          {/* Plugins */}
          <Route path="/plugins" element={<ProtectedRoute requiredRole="admin"><Plugins /></ProtectedRoute>} />

          {/* Dynamic plugin routes (build-time, from src/plugins/registry.ts) */}
          {getPluginRoutes().map((r) => (
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
