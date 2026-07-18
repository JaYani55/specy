import React from 'react';
import { Outlet } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import Navbar from '../ui/Navbar';
import Breadcrumb from '../navigation/Breadcrumb';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"

const Layout = () => {
  const { isFirstLogin } = useAuth();
  const { language, layoutMode } = useTheme();
  const [showFirstLoginModal, setShowFirstLoginModal] = React.useState(false);

  if (layoutMode === 'navbar') {
    return (
      <div className="flex flex-col min-h-screen app-layout">
        {/* Skip navigation link for keyboard users */}
        <a 
          href="#main-content" 
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md"
        >
          Skip to main content
        </a>
        
        <header role="banner">
          <Navbar />
          <Breadcrumb />
        </header>
        
        <main 
          id="main-content" 
          role="main" 
          className="flex-grow container mx-auto px-4 py-6"
        >
          <Outlet />
        </main>

        {/* Live region for screen reader announcements */}
        <div 
          id="live-announcements" 
          aria-live="polite" 
          aria-atomic="true" 
          className="sr-only"
        >
          {/* This will be populated by JavaScript when status changes occur */}
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {/* Skip navigation link for keyboard users */}
        <a 
          href="#main-content" 
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md"
        >
          Skip to main content
        </a>

        <header className="flex h-14 sm:h-16 shrink-0 items-center gap-1 sm:gap-2 border-b px-2 sm:px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 sm:mr-2 h-4" />
          <div className="flex flex-1 items-center justify-between min-w-0">
             <Breadcrumb />
          </div>
        </header>
        
        <main 
            id="main-content" 
            role="main" 
            className="flex-1 container mx-auto px-3 sm:px-4 py-4 sm:py-6"
        >
            <Outlet />
        </main>

        {/* Live region for screen reader announcements */}
        <div 
            id="live-announcements" 
            aria-live="polite" 
            aria-atomic="true" 
            className="sr-only"
        >
          {/* This will be populated by JavaScript when status changes occur */}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default Layout;
