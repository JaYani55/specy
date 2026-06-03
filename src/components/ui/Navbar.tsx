import { Button } from "@/components/ui/button";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { usePermissions } from '@/hooks/usePermissions';
import { useEnabledWebapps } from '@/hooks/useEnabledWebapps';
import { getPluginSidebarTree } from '@/plugins/loader';
import { Moon, Sun, Menu, Calendar, Users, List, X, Settings, LogOut, HelpCircle, SlidersHorizontal, FileText, Globe, ClipboardList, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Logo from "../shared/Logo";

const Navbar = () => {
  const { logout, user } = useAuth();
  const { theme, language, toggleTheme } = useTheme();
  const { canAccessVerwaltung } = usePermissions(); // Use centralized permission
  const { webapps } = useEnabledWebapps();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openPluginMenuKey, setOpenPluginMenuKey] = useState<string | null>(null);
  const location = useLocation();
  const userRoles = user?.roles ?? [];

  const menuItems = [
    { icon: Users, label: language === "en" ? "Events" : "Veranstaltungen", href: "/events" },
    { icon: Calendar, label: language === "en" ? "Calendar" : "Kalender", href: "/calendar" },
    { icon: List, label: language === "en" ? "List" : "Liste", href: "/list" },
  ];

  // Use centralized permission instead of role checks
  if (canAccessVerwaltung) {
    menuItems.push(
      {
        icon: FileText,
        label: language === "en" ? "Pages" : "Seiten",
        href: "/pages"
      },
      {
        icon: ClipboardList,
        label: language === "en" ? "Forms" : "Formulare",
        href: "/forms"
      },
      {
        icon: Settings,
        label: language === "en" ? "Administration" : "Verwaltung",
        href: "/admin"
      }
    );
  }

  const pluginMainTree = getPluginSidebarTree('main', userRoles).filter((item) => {
    if (item.requiredRole === 'super-admin') return userRoles.includes('super-admin');
    if (item.requiredRole === 'admin') return userRoles.includes('admin') || userRoles.includes('super-admin');
    return true;
  });

  const webappItems = webapps;

  const toggleMobileMenu = () => setMobileMenuOpen(!mobileMenuOpen);

  useEffect(() => {
    setOpenPluginMenuKey(null);
  }, [location.pathname]);

  const openPluginMenu = pluginMainTree.find((item) => item.key === openPluginMenuKey && item.children.length);

  const togglePluginMenu = (itemKey: string) => {
    setOpenPluginMenuKey((current) => current === itemKey ? null : itemKey);
  };

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex-shrink-0">
            <Link to="/events" className="flex items-center">
              <Logo variant="navbar" />
            </Link>
          </div>

          <div className="hidden md:flex items-center space-x-1">
            {menuItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={`nav-button${location.pathname === item.href || location.pathname.startsWith(`${item.href}/`) ? " nav-button-active" : ""}`}
              >
                <div className="flex items-center space-x-1">
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </div>
              </Link>
            ))}
            {pluginMainTree.map((item) => {
              if (!item.children.length) {
                return (
                  <Link
                    key={item.key}
                    to={item.path}
                    className={`nav-button${location.pathname === item.path || location.pathname.startsWith(`${item.path}/`) ? " nav-button-active" : ""}`}
                  >
                    <div className="flex items-center space-x-1">
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </div>
                  </Link>
                );
              }

              const isActive = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`) || item.children.some((child) => location.pathname === child.path || location.pathname.startsWith(`${child.path}/`));

              return (
                <button
                  key={item.key}
                  type="button"
                  className={`nav-button${isActive ? ' nav-button-active' : ''}`}
                  aria-expanded={openPluginMenuKey === item.key}
                  onClick={() => togglePluginMenu(item.key)}
                >
                  <div className="flex items-center space-x-1">
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                    <ChevronDown className={`h-4 w-4 transition-transform${openPluginMenuKey === item.key ? ' rotate-180' : ''}`} />
                  </div>
                </button>
              );
            })}
            {webappItems.map((item) => (
              <a
                key={item.id}
                href={item.external_url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="nav-button"
              >
                <div className="flex items-center space-x-1">
                  {item.icon_url ? (
                    <img src={item.icon_url} alt="" className="h-4 w-4 rounded-sm object-contain" />
                  ) : (
                    <Globe className="h-4 w-4" />
                  )}
                  <span>{item.name}</span>
                </div>
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2 md:gap-6">
            {/* Info */}
            <Link
              to="/Info"
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 active:bg-gray-200 border transition-colors"
              aria-label={language === "en" ? "Info" : "Info"}
            >
              <HelpCircle className="h-4 w-4" />
              <span className="font-semibold">{language === "en" ? "Info" : "Info"}</span>
            </Link>

            {/* Preferences */}
            <Link
              to="/settings"
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-medium transition-colors border ${
                location.pathname === '/settings'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'text-gray-700 hover:bg-gray-100 active:bg-gray-200'
              }`}
              aria-label={language === "en" ? "Preferences" : "Einstellungen"}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="font-semibold hidden md:inline">{language === "en" ? "Preferences" : "Einstellungen"}</span>
            </Link>

            <button
              onClick={toggleTheme}
              className="p-2 text-gray-500 hover:text-gray-900 focus:outline-none"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>

            {user && (
              <Button
                onClick={logout}
                variant="ghost"
                className="hidden md:flex px-3 py-2 rounded-md text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              >
                {language === "en" ? "Logout" : "Abmelden"}
              </Button>
            )}

            <button
              className="md:hidden p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none"
              onClick={toggleMobileMenu}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {openPluginMenu ? (
          <div className="hidden md:block border-t py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={openPluginMenu.path}
                className={`nav-button${location.pathname === openPluginMenu.path || location.pathname.startsWith(`${openPluginMenu.path}/`) ? " nav-button-active" : ""}`}
              >
                <div className="flex items-center space-x-1">
                  <openPluginMenu.icon className="h-4 w-4" />
                  <span>{openPluginMenu.label}</span>
                </div>
              </Link>
              {openPluginMenu.children.map((child) => (
                <Link
                  key={child.key}
                  to={child.path}
                  className={`nav-button${location.pathname === child.path || location.pathname.startsWith(`${child.path}/`) ? " nav-button-active" : ""}`}
                >
                  <div className="flex items-center space-x-1">
                    <child.icon className="h-4 w-4" />
                    <span>{child.label}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {mobileMenuOpen && (
          <div className="md:hidden py-4 space-y-2 pb-4 animate-in fade-in slide-in-from-top border-t">
            {menuItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={`flex items-center px-3 py-3 rounded-md text-base font-medium ${
                  location.pathname === item.href || location.pathname.startsWith(`${item.href}/`)
                    ? "bg-primary text-primary-foreground"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                }`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <item.icon className="h-5 w-5 mr-2" />
                <span>{item.label}</span>
              </Link>
            ))}
            {pluginMainTree.map((item) => {
              const isActive = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`) || item.children.some((child) => location.pathname === child.path || location.pathname.startsWith(`${child.path}/`));

              if (!item.children.length) {
                return (
                  <Link
                    key={item.key}
                    to={item.path}
                    className={`flex items-center px-3 py-3 rounded-md text-base font-medium ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <item.icon className="h-5 w-5 mr-2" />
                    <span>{item.label}</span>
                  </Link>
                );
              }

              return (
                <div key={item.key} className="rounded-md border border-gray-200/80 overflow-hidden">
                  <button
                    type="button"
                    className={`flex w-full items-center px-3 py-3 text-base font-medium ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                    aria-expanded={openPluginMenuKey === item.key}
                    onClick={() => togglePluginMenu(item.key)}
                  >
                    <item.icon className="h-5 w-5 mr-2" />
                    <span className="flex-1 text-left">{item.label}</span>
                    <ChevronDown className={`h-5 w-5 transition-transform${openPluginMenuKey === item.key ? ' rotate-180' : ''}`} />
                  </button>
                  {openPluginMenuKey === item.key ? (
                    <div className="border-t bg-gray-50/70">
                      <Link
                        to={item.path}
                        className={`flex items-center px-4 py-3 text-sm font-medium ${
                          location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
                            ? "bg-primary/10 text-primary"
                            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                        }`}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <item.icon className="h-4 w-4 mr-2" />
                        <span>{item.label}</span>
                      </Link>
                      {item.children.map((child) => (
                        <Link
                          key={child.key}
                          to={child.path}
                          className={`flex items-center px-4 py-3 text-sm font-medium ${
                            location.pathname === child.path || location.pathname.startsWith(`${child.path}/`)
                              ? "bg-primary/10 text-primary"
                              : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                          }`}
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          <child.icon className="h-4 w-4 mr-2" />
                          <span>{child.label}</span>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {webappItems.map((item) => (
              <a
                key={item.id}
                href={item.external_url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center px-3 py-3 rounded-md text-base font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.icon_url ? (
                  <img src={item.icon_url} alt="" className="h-5 w-5 mr-2 rounded-sm object-contain" />
                ) : (
                  <Globe className="h-5 w-5 mr-2" />
                )}
                <span>{item.name}</span>
              </a>
            ))}
            
            {user && (
              <button
                onClick={() => {
                  logout();
                  setMobileMenuOpen(false);
                }}
                className="flex w-full items-center px-3 py-3 rounded-md text-base font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              >
                <LogOut className="h-5 w-5 mr-2" />
                <span>{language === "en" ? "Logout" : "Abmelden"}</span>
              </button>
            )}
            <Link
              to="/settings"
              className={`flex items-center px-3 py-3 rounded-md text-base font-medium ${
                location.pathname === '/settings'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
              }`}
              onClick={() => setMobileMenuOpen(false)}
            >
              <SlidersHorizontal className="h-5 w-5 mr-2" />
              <span>{language === "en" ? "Preferences" : "Einstellungen"}</span>
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
