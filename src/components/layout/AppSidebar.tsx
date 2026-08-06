import { Bot, Box, Calendar, Settings, Users, User, List, LogOut, HelpCircle, Moon, Sun, ChevronUp, FileText, SlidersHorizontal, Puzzle, Globe, ClipboardList, ChevronDown, Building2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useLocation, Link, useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { usePermissions } from "@/hooks/usePermissions"
import { useEnabledWebapps } from "@/hooks/useEnabledWebapps"
import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext"
import { getPluginSidebarTree } from "@/plugins/loader"
import Logo from "@/components/shared/Logo"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarHeader,
  SidebarFooter,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu"

export function AppSidebar() {
  const { logout, user } = useAuth()
  const { theme, language, toggleTheme } = useTheme()
  const { canAccessVerwaltung, canManagePlugins } = usePermissions()
  const { webapps } = useEnabledWebapps()
  const { options: workspaceOptions, activeTenant, activeTenantId, setActiveTenantId } = useActiveWorkspace()
  const location = useLocation()
  const navigate = useNavigate()
  const [openPluginKey, setOpenPluginKey] = useState<string | null>(null)
  const [isMcpOpen, setIsMcpOpen] = useState(location.pathname === '/mcp' || location.pathname.startsWith('/mcp/'))

  useEffect(() => {
    if (location.pathname === '/mcp' || location.pathname.startsWith('/mcp/')) {
      setIsMcpOpen(true)
    }
  }, [location.pathname])

  const items = [
    {
      title: language === "en" ? "Events" : "Veranstaltungen",
      url: "/events",
      icon: Users,
    },
    {
      title: language === "en" ? "Calendar" : "Kalender",
      url: "/calendar",
      icon: Calendar,
    },
    {
      title: language === "en" ? "List" : "Liste",
      url: "/list",
      icon: List,
    },
  ]

  if (canAccessVerwaltung) {
    items.push(
      {
        title: language === "en" ? "Pages" : "Seiten",
        url: "/pages",
        icon: FileText,
      },
      {
        title: language === "en" ? "Forms" : "Formulare",
        url: "/forms",
        icon: ClipboardList,
      },
      {
        title: language === "en" ? "Objects" : "Objekte",
        url: "/objects",
        icon: Box,
      },
      {
        title: "MCP",
        url: "/mcp",
        icon: Bot,
      },
      {
        title: language === "en" ? "Administration" : "Verwaltung",
        url: "/admin",
        icon: Settings,
      }
    )
  }

  if (canManagePlugins) {
    items.push({
      title: "Plugins",
      url: "/plugins",
      icon: Puzzle,
    })
  }

  // Dynamic sidebar items from installed plugins (admin group)
  const pluginAdminItems = useMemo(
    () => canAccessVerwaltung
      ? getPluginSidebarTree('admin', user?.roles ?? []).filter((item) => {
          if (item.requiredRole === 'super-admin') return user?.roles?.includes('super-admin') ?? false;
          if (item.requiredRole === 'admin') return canManagePlugins;
          return true;
        })
      : [],
    [canAccessVerwaltung, canManagePlugins, user?.roles]
  )

  // Dynamic sidebar items from installed plugins (main group — visible to all authenticated users)
  const pluginMainItems = useMemo(
    () => getPluginSidebarTree('main', user?.roles ?? []).filter((item) => {
      if (item.requiredRole === 'super-admin') return user?.roles?.includes('super-admin') ?? false;
      if (item.requiredRole === 'admin') return canManagePlugins;
      return true;
    }),
    [canManagePlugins, user?.roles]
  )
  const webappItems = webapps

  useEffect(() => {
    const activePluginItem = [...pluginMainItems, ...pluginAdminItems].find((item) =>
      item.children.some((child) => location.pathname === child.path || location.pathname.startsWith(`${child.path}/`))
    )

    setOpenPluginKey(activePluginItem?.key ?? null)
  }, [location.pathname, pluginAdminItems, pluginMainItems])

  const renderPluginItem = (item: (typeof pluginMainItems)[number]) => {
    const isActive =
      location.pathname === item.path ||
      location.pathname.startsWith(`${item.path}/`) ||
      item.children.some((child) => location.pathname === child.path || location.pathname.startsWith(`${child.path}/`))

    if (!item.children.length) {
      return (
        <SidebarMenuButton
          asChild
          isActive={isActive}
          tooltip={item.label}
        >
          <Link to={item.path}>
            <item.icon />
            <span>{item.label}</span>
          </Link>
        </SidebarMenuButton>
      )
    }

    const isOpen = openPluginKey === item.key

    return (
      <Collapsible
        open={isOpen}
        onOpenChange={(open) => setOpenPluginKey(open ? item.key : null)}
        className="w-full"
      >
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={isActive}
            tooltip={item.label}
          >
            <item.icon />
            <span>{item.label}</span>
            <ChevronDown className={`ml-auto transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                asChild
                isActive={location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)}
              >
                <Link to={item.path}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
            {item.children.map((child) => (
              <SidebarMenuSubItem key={child.key}>
                <SidebarMenuSubButton
                  asChild
                  isActive={location.pathname === child.path || location.pathname.startsWith(`${child.path}/`)}
                >
                  <Link to={child.path}>
                    <child.icon />
                    <span>{child.label}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center justify-center px-3 py-4">
          <Link to="/events" className="flex min-h-[56px] w-full items-center justify-center">
            <Logo variant="sidebar" className="max-w-full" />
           </Link>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Application</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => item.url === '/mcp' ? (
                <SidebarMenuItem key={item.title}>
                  <Collapsible open={isMcpOpen} onOpenChange={setIsMcpOpen} className="w-full">
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        isActive={isMcpOpen}
                        tooltip={item.title}
                        onClick={() => navigate('/mcp')}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                        <ChevronDown className={`ml-auto transition-transform ${isMcpOpen ? 'rotate-180' : ''}`} />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild isActive={location.pathname === '/mcp'}>
                            <Link to="/mcp"><Bot /><span>{language === 'en' ? 'Registry' : 'Registry'}</span></Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild isActive={location.pathname === '/mcp/specs'}>
                            <Link to="/mcp/specs"><FileText /><span>{language === 'en' ? 'Prompt Specs' : 'Prompt-Specs'}</span></Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </Collapsible>
                </SidebarMenuItem>
              ) : (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location.pathname === item.url || location.pathname.startsWith(`${item.url}/`)}
                    tooltip={item.title}
                  >
                    <Link to={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {webappItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton asChild tooltip={item.name}>
                    <a href={item.external_url ?? '#'} target="_blank" rel="noopener noreferrer">
                      {item.icon_url ? (
                        <img src={item.icon_url} alt="" className="h-4 w-4 rounded-sm object-contain" />
                      ) : (
                        <Globe />
                      )}
                      <span>{item.name}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {/* Plugin main-group sidebar items */}
              {pluginMainItems.map((item) => (
                <SidebarMenuItem key={item.key}>
                  {renderPluginItem(item)}
                </SidebarMenuItem>
              ))}
              {/* Plugin admin-group sidebar items */}
              {pluginAdminItems.map((item) => (
                <SidebarMenuItem key={item.key}>
                  {renderPluginItem(item)}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>{language === 'en' ? 'Settings' : 'Einstellungen'}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip={language === 'en' ? 'Info' : 'Info'}>
                  <Link to="/Info">
                    <HelpCircle />
                    <span>{language === 'en' ? 'Info' : 'Info'}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip={language === 'en' ? 'Preferences' : 'Einstellungen'}>
                  <Link to="/settings">
                    <SlidersHorizontal />
                    <span>{language === 'en' ? 'Preferences' : 'Einstellungen'}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton onClick={toggleTheme} tooltip={language === 'en' ? 'Toggle Theme' : 'Design wechseln'}>
                  {theme === 'dark' ? <Sun /> : <Moon />}
                  <span>{theme === 'dark' ? (language === 'en' ? 'Light Mode' : 'Heller Modus') : (language === 'en' ? 'Dark Mode' : 'Dunkler Modus')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton onClick={logout} tooltip={language === 'en' ? 'Logout' : 'Abmelden'}>
                  <LogOut />
                  <span>{language === 'en' ? 'Logout' : 'Abmelden'}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <User className="size-8" />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{user?.email}</span>
                    <span className="truncate text-xs text-muted-foreground">{activeTenant?.organization_name ?? activeTenant?.name ?? (language === 'en' ? 'User' : 'Benutzer')}</span>
                  </div>
                  <ChevronUp className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                className="w-[--radix-popper-anchor-width]"
              >
              {workspaceOptions.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground px-2 py-1.5">
                    {language === 'en' ? 'Workspace' : 'Arbeitsbereich'}
                  </DropdownMenuLabel>
                  {workspaceOptions.map((option) => (
                    <DropdownMenuCheckboxItem
                      key={option.id}
                      checked={option.id === activeTenantId}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={() => setActiveTenantId(option.id)}
                    >
                      <span className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {option.organization_name ?? option.name}
                      </span>
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/admin/organization" className="flex items-center gap-2 w-full">
                      <Building2 className="h-4 w-4" />
                      <span>{language === 'en' ? 'Organization' : 'Organisation'}</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem asChild>
                  <Link to="/settings" className="flex items-center gap-2 w-full">
                      <SlidersHorizontal className="h-4 w-4" />
                      <span>{language === 'en' ? 'Preferences' : 'Einstellungen'}</span>
                  </Link>
              </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleTheme}>
                    {theme === "dark" ? (
                        <div className="flex items-center gap-2 w-full">
                            <Sun className="h-4 w-4" />
                            <span>Light Mode</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 w-full">
                            <Moon className="h-4 w-4" />
                            <span>Dark Mode</span>
                        </div>
                    )}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link to="/Info" className="flex items-center gap-2 w-full">
                        <HelpCircle className="h-4 w-4" />
                        <span>Info</span>
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>{language === "en" ? "Logout" : "Abmelden"}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
