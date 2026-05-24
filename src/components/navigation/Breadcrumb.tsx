
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

interface BreadcrumbItem {
  label: string;
  path?: string;
  isActive?: boolean;
}

const Breadcrumb: React.FC = () => {
  const location = useLocation();
  const { language } = useTheme();

  // Define route translations and hierarchies
  const routeConfig: Record<string, { 
    label: { en: string; de: string };
    parent?: string;
  }> = {
    '/': { label: { en: 'Home', de: 'Startseite' } },
    '/events': { label: { en: 'Events', de: 'Veranstaltungen' } },
    '/calendar': { label: { en: 'Calendar', de: 'Kalender' } },
    '/list': { label: { en: 'List View', de: 'Liste' } },
    '/create-event': { label: { en: 'Create Event', de: 'Veranstaltung erstellen' } },
    '/profile': { label: { en: 'Profile', de: 'Profil' } },
    '/settings': { label: { en: 'Settings', de: 'Einstellungen' } },
    '/me': { label: { en: 'My Profile', de: 'Mein Profil' } },
    '/admin': { label: { en: 'Administration', de: 'Verwaltung' } },
    '/admin/add-mentor': { 
      label: { en: 'Add Staff', de: 'Mitarbeiter hinzufügen' },
      parent: '/admin'
    },
    '/admin/all-mentors': { 
      label: { en: 'All Staff', de: 'Alle Mitarbeiter' },
      parent: '/admin'
    },
    '/admin/all-products': { 
      label: { en: 'All Products', de: 'Alle Produkte' },
      parent: '/admin'
    },
    '/admin/create-product': { 
      label: { en: 'Create Product', de: 'Produkt erstellen' },
      parent: '/admin'
    },
    '/admin/trait': { 
      label: { en: 'Manage Traits', de: 'Eigenschaften verwalten' },
      parent: '/admin'
    },
    '/admin/traitsmentorassign': { 
      label: { en: 'Assign Traits', de: 'Eigenschaften zuweisen' },
      parent: '/admin'
    },
    '/admin/accounts': { 
      label: { en: 'Account Management', de: 'Kontoverwaltung' },
      parent: '/admin'
    },
    '/admin/api': {
      label: { en: 'API Administration', de: 'API Administration' },
      parent: '/admin'
    },
    '/admin/branding': {
      label: { en: 'Branding', de: 'Branding' },
      parent: '/admin'
    },
    '/pages': { label: { en: 'Pages', de: 'Seiten' } },
    '/pages/schema/new': {
      label: { en: 'New Schema', de: 'Neues Schema' },
      parent: '/pages'
    },
    '/forms': { label: { en: 'Forms', de: 'Formulare' } },
    '/forms/new': {
      label: { en: 'New Form', de: 'Neues Formular' },
      parent: '/forms'
    },
    '/mcp': { label: { en: 'MCP', de: 'MCP' } },
    '/mcp/new': {
      label: { en: 'New Spec', de: 'Neue Spec' },
      parent: '/mcp'
    },
    '/plugins': { label: { en: 'Plugins', de: 'Plugins' } },
  };

  const generateBreadcrumbs = (): BreadcrumbItem[] => {
    const pathnames = location.pathname.split('/').filter(x => x);
    const breadcrumbs: BreadcrumbItem[] = [];

    // Always start with home
    breadcrumbs.push({
      label: routeConfig['/']?.label[language] || 'Home',
      path: '/',
      isActive: location.pathname === '/'
    });

    // Handle dynamic routes (like /events/:id, /admin/product/:productId)
    let currentPath = '';
    
    for (let i = 0; i < pathnames.length; i++) {
      currentPath += `/${pathnames[i]}`;
      
      // Check if this is a dynamic parameter (like an ID)
      const isId = /^\d+$/.test(pathnames[i]);
      
      if (isId && i > 0) {
        // For IDs, use the parent route config but modify the label
        const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
        const config = routeConfig[parentPath];
        
        if (config) {
          // For product details, show "Product Details" instead of the ID
          if (parentPath === '/admin/product') {
            breadcrumbs.push({
              label: language === 'en' ? 'Product Details' : 'Produktdetails',
              isActive: i === pathnames.length - 1
            });
          } else if (parentPath === '/events') {
            breadcrumbs.push({
              label: language === 'en' ? 'Event Details' : 'Termindetails',
              isActive: i === pathnames.length - 1
            });
          } else if (parentPath === '/edit-event') {
            breadcrumbs.push({
              label: language === 'en' ? 'Edit Event' : 'Termin bearbeiten',
              isActive: i === pathnames.length - 1
            });
          } else if (parentPath === '/profile') {
            breadcrumbs.push({
              label: language === 'en' ? 'User Profile' : 'Benutzerprofil',
              isActive: i === pathnames.length - 1
            });
          }
        }
      } else {
        // Regular route
        const config = routeConfig[currentPath];
        if (config) {
          breadcrumbs.push({
            label: config.label[language],
            path: currentPath,
            isActive: i === pathnames.length - 1
          });
        } else if (currentPath.startsWith('/forms/')) {
          const segments = currentPath.split('/');
          if (segments.length === 3) {
            breadcrumbs.push({
              label: language === 'en' ? 'Form Details' : 'Formulardetails',
              path: currentPath,
              isActive: i === pathnames.length - 1,
            });
          } else if (segments.length === 4 && segments[3] === 'answers') {
            breadcrumbs.push({
              label: language === 'en' ? 'Answers' : 'Antworten',
              isActive: true,
            });
          }
        } else if (currentPath.startsWith('/mcp/')) {
          const segments = currentPath.split('/');
          if (segments.length === 3) {
            breadcrumbs.push({
              label: language === 'en' ? 'MCP Details' : 'MCP-Details',
              path: currentPath,
              isActive: i === pathnames.length - 1,
            });
          }
        } else if (currentPath.startsWith('/pages/schema/')) {
          // Handle dynamic pages/schema routes
          const segments = currentPath.split('/');
          if (segments.length === 4) {
            // /pages/schema/:slug
            breadcrumbs.push({
              label: decodeURIComponent(pathnames[i]),
              path: currentPath,
              isActive: i === pathnames.length - 1
            });
          } else if (segments.length === 5) {
            const lastSegment = segments[4];
            if (lastSegment === 'settings') {
              breadcrumbs.push({
                label: language === 'en' ? 'Schema Settings' : 'Schema-Einstellungen',
                isActive: true
              });
            } else if (lastSegment === 'new') {
              breadcrumbs.push({
                label: language === 'en' ? 'New Page' : 'Neue Seite',
                isActive: true
              });
            }
          } else if (segments.length === 6 && segments[4] === 'edit') {
            breadcrumbs.push({
              label: language === 'en' ? 'Edit Page' : 'Seite bearbeiten',
              isActive: true
            });
          }
        }
      }
    }

    return breadcrumbs;
  };

  const breadcrumbs = generateBreadcrumbs();

  // Don't show breadcrumbs on login page or if only home
  if (location.pathname === '/login' || breadcrumbs.length <= 1) {
    return null;
  }

  return (
    <nav 
      aria-label={language === 'en' ? 'Breadcrumb navigation' : 'Brotkrümel-Navigation'}
      className="flex items-center space-x-1 text-sm text-muted-foreground py-2 px-4 bg-muted/30"
    >
      {breadcrumbs.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
          )}
          
          {item.isActive ? (
            <span 
              className="text-foreground font-medium"
              aria-current="page"
            >
              {index === 0 && <Home className="h-4 w-4 inline mr-1" />}
              {item.label}
            </span>
          ) : (
            <Link
              to={item.path || '#'}
              className="hover:text-foreground transition-colors duration-200 flex items-center"
              onClick={item.path ? undefined : (e) => e.preventDefault()}
            >
              {index === 0 && <Home className="h-4 w-4 inline mr-1" />}
              {item.label}
            </Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
};

export default Breadcrumb;