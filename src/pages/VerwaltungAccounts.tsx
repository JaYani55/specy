import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useNavigate } from 'react-router-dom';
import {
  fetchRoles,
  fetchAdminAccounts,
  assignRole,
  removeRole,
  createAccount,
  type Role,
  type AccountUser,
} from '@/services/accountService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  createTenant,
  deleteTenantMembership,
  getTenantMemberships,
  getVisibleTenants,
  updateTenant,
  updateTenantMembership,
  upsertTenantMembership,
  type TenantMembershipRecord,
  type TenantRecord,
} from '@/services/tenantService';
import {
  Shield,
  UserPlus,
  Plus,
  Users,
  ShieldCheck,
  Loader2,
  ArrowLeft,
  X,
  ChevronDown,
  ChevronUp,
  Building2,
  UserCog,
  UserMinus,
} from 'lucide-react';

// ─── Role Color Map ─────────────────────────────────────────────────
const ROLE_COLORS: Record<string, string> = {
  'super-admin': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  staff: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  mentoringmanagement: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  mentor: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  coach: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  guest: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

const getRoleBadgeClass = (roleName: string) =>
  ROLE_COLORS[roleName] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }

  return fallback;
};

// ─── Main Page Component ────────────────────────────────────────────

const VerwaltungAccounts: React.FC = () => {
  const { language } = useTheme();
  const permissions = usePermissions();
  const navigate = useNavigate();

  const [roles, setRoles] = useState<Role[]>([]);
  const [accounts, setAccounts] = useState<AccountUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'accounts' | 'roles' | 'tenants'>('accounts');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [tenantMemberships, setTenantMemberships] = useState<TenantMembershipRecord[]>([]);

  // Dialog states
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [showAssignRole, setShowAssignRole] = useState(false);
  const [showCreateTenant, setShowCreateTenant] = useState(false);
  const [showManageTenant, setShowManageTenant] = useState(false);

  // Selected items
  const [selectedUser, setSelectedUser] = useState<AccountUser | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<TenantRecord | null>(null);

  // Expanded user cards
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

  // Form states
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newAccountRoleIds, setNewAccountRoleIds] = useState<number[]>([]);
  const [assignRoleId, setAssignRoleId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [newTenantName, setNewTenantName] = useState('');
  const [newTenantSlug, setNewTenantSlug] = useState('');
  const [tenantDraftName, setTenantDraftName] = useState('');
  const [tenantDraftSlug, setTenantDraftSlug] = useState('');
  const [tenantMemberUserId, setTenantMemberUserId] = useState('');
  const [tenantMemberAdmin, setTenantMemberAdmin] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  const de = language === 'de';
  const isSuperAdmin = permissions.userRoles.includes('super-admin');

  // ─── Data Loading ───────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [rolesData, accountsData, tenantsData, membershipsData] = await Promise.all([
        fetchRoles(),
        fetchAdminAccounts(),
        isSuperAdmin ? getVisibleTenants() : Promise.resolve([]),
        isSuperAdmin ? getTenantMemberships() : Promise.resolve([]),
      ]);
      setRoles(rolesData);
      setAccounts(accountsData);
      setTenants(tenantsData as TenantRecord[]);
      setTenantMemberships(membershipsData as TenantMembershipRecord[]);
    } catch (err) {
      console.error('Failed to load account data:', err);
      toast.error(de ? 'Fehler beim Laden der Kontodaten' : 'Failed to load account data');
    } finally {
      setLoading(false);
    }
  }, [de, isSuperAdmin]);

  useEffect(() => {
    if (!permissions.canManageAccounts) {
      navigate('/admin');
      return;
    }
    loadData();
  }, [permissions.canManageAccounts, navigate, loadData]);

  // ─── Account Creation Handler ───────────────────────────────────

  const handleCreateAccount = async () => {
    if (!newEmail.trim() || !newPassword.trim()) return;
    setSubmitting(true);
    try {
      await createAccount({
        email: newEmail.trim(),
        password: newPassword.trim(),
        username: newUsername.trim() || undefined,
        roleIds: newAccountRoleIds.length > 0 ? newAccountRoleIds : undefined,
      });
      toast.success(de ? 'Konto erstellt' : 'Account created');
      setShowCreateAccount(false);
      setNewEmail('');
      setNewPassword('');
      setNewUsername('');
      setNewAccountRoleIds([]);
      await loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, de ? 'Fehler beim Erstellen des Kontos' : 'Error creating account'));
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Role Assignment Handlers ───────────────────────────────────

  const handleAssignRole = async () => {
    if (!selectedUser || !assignRoleId) return;
    setSubmitting(true);
    try {
      await assignRole(selectedUser.user_id, parseInt(assignRoleId));
      toast.success(de ? 'Rolle zugewiesen' : 'Role assigned');
      setShowAssignRole(false);
      setAssignRoleId('');
      setSelectedUser(null);
      await loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, de ? 'Fehler bei Rollenzuweisung' : 'Error assigning role'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveRole = async (userId: string, roleId: number) => {
    try {
      await removeRole(userId, roleId);
      toast.success(de ? 'Rolle entfernt' : 'Role removed');
      await loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, de ? 'Fehler beim Entfernen' : 'Error removing role'));
    }
  };

  const openManageTenant = (tenant: TenantRecord) => {
    setSelectedTenant(tenant);
    setTenantDraftName(tenant.name);
    setTenantDraftSlug(tenant.slug);
    setTenantMemberUserId('');
    setTenantMemberAdmin(false);
    setShowManageTenant(true);
  };

  const handleCreateTenant = async () => {
    if (!newTenantName.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      await createTenant({ name: newTenantName.trim(), slug: newTenantSlug.trim() || undefined });
      toast.success(de ? 'Workspace erstellt' : 'Workspace created');
      setShowCreateTenant(false);
      setNewTenantName('');
      setNewTenantSlug('');
      await loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, de ? 'Fehler beim Erstellen des Workspaces' : 'Error creating workspace'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateTenant = async () => {
    if (!selectedTenant || !tenantDraftName.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      const updated = await updateTenant(selectedTenant.id, {
        name: tenantDraftName.trim(),
        slug: tenantDraftSlug.trim() || tenantDraftName.trim(),
      });
      setSelectedTenant(updated);
      toast.success(de ? 'Workspace gespeichert' : 'Workspace saved');
      await loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, de ? 'Fehler beim Speichern des Workspaces' : 'Error saving workspace'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddTenantMember = async () => {
    if (!selectedTenant || !tenantMemberUserId) {
      return;
    }

    setSubmitting(true);
    try {
      await upsertTenantMembership({
        tenant_id: selectedTenant.id,
        user_id: tenantMemberUserId,
        is_tenant_admin: tenantMemberAdmin,
        status: 'active',
      });
      toast.success(de ? 'Benutzer dem Workspace zugewiesen' : 'User assigned to workspace');
      setTenantMemberUserId('');
      setTenantMemberAdmin(false);
      await loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, de ? 'Fehler bei der Workspace-Zuweisung' : 'Error assigning workspace member'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleTenantAdmin = async (membership: TenantMembershipRecord) => {
    setSubmitting(true);
    try {
      await updateTenantMembership(membership.tenant_id, membership.user_id, {
        is_tenant_admin: !membership.is_tenant_admin,
      });
      toast.success(de ? 'Tenant-Admin-Status aktualisiert' : 'Tenant admin status updated');
      await loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, de ? 'Fehler beim Aktualisieren des Tenant-Admins' : 'Error updating tenant admin'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveTenantMember = async (membership: TenantMembershipRecord) => {
    setSubmitting(true);
    try {
      await deleteTenantMembership(membership.tenant_id, membership.user_id);
      toast.success(de ? 'Mitglied entfernt' : 'Member removed');
      await loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, de ? 'Fehler beim Entfernen des Mitglieds' : 'Error removing member'));
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Helpers ────────────────────────────────────────────────────

  const toggleUserExpanded = (userId: string) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const openAssignRole = (user: AccountUser) => {
    setSelectedUser(user);
    setAssignRoleId('');
    setShowAssignRole(true);
  };

  const toggleAccountRoleId = (roleId: number) => {
    setNewAccountRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    );
  };

  // Filter accounts by search
  const filteredAccounts = accounts.filter((a) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.Username?.toLowerCase().includes(q) ||
      a.email?.toLowerCase().includes(q) ||
      a.user_id.toLowerCase().includes(q) ||
      a.roles.some((r) => r.name.toLowerCase().includes(q))
    );
  });

  const accountsById = useMemo(
    () => new Map(accounts.map((account) => [account.user_id, account])),
    [accounts],
  );

  const membershipsByUser = useMemo(() => {
    return tenantMemberships.reduce<Record<string, TenantMembershipRecord[]>>((accumulator, membership) => {
      if (!accumulator[membership.user_id]) {
        accumulator[membership.user_id] = [];
      }
      accumulator[membership.user_id].push(membership);
      return accumulator;
    }, {});
  }, [tenantMemberships]);

  const membershipsForSelectedTenant = useMemo(() => {
    if (!selectedTenant) {
      return [];
    }

    return tenantMemberships.filter((membership) => membership.tenant_id === selectedTenant.id);
  }, [selectedTenant, tenantMemberships]);

  const assignableAccountsForSelectedTenant = useMemo(() => {
    if (!selectedTenant) {
      return accounts;
    }

    const existingUserIds = new Set(
      tenantMemberships
        .filter((membership) => membership.tenant_id === selectedTenant.id && membership.status === 'active')
        .map((membership) => membership.user_id),
    );

    return accounts.filter((account) => !existingUserIds.has(account.user_id));
  }, [accounts, selectedTenant, tenantMemberships]);

  // ─── Loading State ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400 mx-auto" />
          <p className="text-gray-500 dark:text-gray-400">
            {de ? 'Lade Kontodaten...' : 'Loading account data...'}
          </p>
        </div>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin')}
            className="mb-4 text-gray-600 dark:text-gray-400"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            {de ? 'Zurück zur Verwaltung' : 'Back to Administration'}
          </Button>

          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-r from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <ShieldCheck className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                {de ? 'Kontoverwaltung' : 'Account Management'}
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                {de
                  ? 'Benutzerkonten, Rollen, Tenants und Zugriffsrechte verwalten'
                  : 'Manage user accounts, roles, tenants, and access permissions'}
              </p>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-8">
          <Button
            variant={activeTab === 'accounts' ? 'default' : 'outline'}
            onClick={() => setActiveTab('accounts')}
            className="gap-2"
          >
            <Users className="h-4 w-4" />
            {de ? 'Benutzerkonten' : 'User Accounts'}
            <Badge variant="secondary" className="ml-1">{accounts.length}</Badge>
          </Button>
          <Button
            variant={activeTab === 'roles' ? 'default' : 'outline'}
            onClick={() => setActiveTab('roles')}
            className="gap-2"
          >
            <Shield className="h-4 w-4" />
            {de ? 'Rollen' : 'Roles'}
            <Badge variant="secondary" className="ml-1">{roles.length}</Badge>
          </Button>
          {isSuperAdmin && (
            <Button
              variant={activeTab === 'tenants' ? 'default' : 'outline'}
              onClick={() => setActiveTab('tenants')}
              className="gap-2"
            >
              <Building2 className="h-4 w-4" />
              {de ? 'Tenants' : 'Tenants'}
              <Badge variant="secondary" className="ml-1">{tenants.length}</Badge>
            </Button>
          )}
        </div>

        {/* ═══ ACCOUNTS TAB ═══ */}
        {activeTab === 'accounts' && (
          <div className="space-y-6">
            {/* Actions Bar */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <Input
                placeholder={de ? 'Konten durchsuchen...' : 'Search accounts...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-sm"
              />
              <Dialog open={showCreateAccount} onOpenChange={setShowCreateAccount}>
                <DialogTrigger asChild>
                  <Button className="gap-2 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700">
                    <UserPlus className="h-4 w-4" />
                    {de ? 'Neues Konto erstellen' : 'Create New Account'}
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>{de ? 'Neues Konto erstellen' : 'Create New Account'}</DialogTitle>
                    <DialogDescription>
                      {de
                        ? 'Erstellen Sie ein neues Benutzerkonto mit optionaler Rollenzuweisung.'
                        : 'Create a new user account with optional role assignment.'}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>{de ? 'E-Mail-Adresse' : 'Email Address'} *</Label>
                      <Input
                        type="email"
                        placeholder="name@example.com"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{de ? 'Passwort' : 'Password'} *</Label>
                      <Input
                        type="password"
                        placeholder={de ? 'Mindestens 6 Zeichen' : 'At least 6 characters'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{de ? 'Benutzername' : 'Username'}</Label>
                      <Input
                        placeholder={de ? 'Optional' : 'Optional'}
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                      />
                    </div>
                    <Separator />
                    <div className="space-y-2">
                      <Label>{de ? 'Rollen zuweisen' : 'Assign Roles'}</Label>
                      <div className="flex flex-wrap gap-2">
                        {roles.map((role) => (
                          <Badge
                            key={role.id}
                            variant={newAccountRoleIds.includes(role.id) ? 'default' : 'outline'}
                            className="cursor-pointer select-none"
                            onClick={() => toggleAccountRoleId(role.id)}
                          >
                            {newAccountRoleIds.includes(role.id) && '✓ '}
                            {role.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowCreateAccount(false)}>
                      {de ? 'Abbrechen' : 'Cancel'}
                    </Button>
                    <Button
                      onClick={handleCreateAccount}
                      disabled={submitting || !newEmail.trim() || !newPassword.trim()}
                    >
                      {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      {de ? 'Konto erstellen' : 'Create Account'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {/* Accounts List */}
            {filteredAccounts.length === 0 ? (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-12 text-center">
                  <Users className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">
                    {searchQuery
                      ? (de ? 'Keine Konten gefunden.' : 'No accounts found.')
                      : (de ? 'Noch keine Benutzerkonten vorhanden.' : 'No user accounts yet.')}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredAccounts.map((account) => {
                  const isExpanded = expandedUsers.has(account.user_id);
                  return (
                    <Card
                      key={account.user_id}
                      className="border-0 shadow-sm hover:shadow-md transition-shadow"
                    >
                      <CardContent className="py-4">
                        {/* Main Row */}
                        <div
                          className="flex items-center gap-4 cursor-pointer"
                          onClick={() => toggleUserExpanded(account.user_id)}
                        >
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={account.pfp_url || ''} />
                            <AvatarFallback className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                              {(account.Username || account.email || '?')[0]?.toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 dark:text-white truncate">
                                {account.Username || (de ? 'Kein Benutzername' : 'No username')}
                              </p>
                              {account.email && (
                                <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
                                  {account.email}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {account.roles.length > 0 ? (
                                account.roles.map((role) => (
                                  <Badge
                                    key={role.id}
                                    variant="secondary"
                                    className={`text-xs ${getRoleBadgeClass(role.name)}`}
                                  >
                                    {role.name}
                                  </Badge>
                                ))
                              ) : (
                                <Badge variant="outline" className="text-xs text-gray-400">
                                  {de ? 'Keine Rolle' : 'No role'}
                                </Badge>
                              )}
                              {(membershipsByUser[account.user_id] ?? []).map((membership) => {
                                const tenant = tenants.find((entry) => entry.id === membership.tenant_id);
                                if (!tenant) return null;

                                return (
                                  <Badge key={`${membership.tenant_id}-${membership.user_id}`} variant="outline" className="text-xs">
                                    {tenant.name}
                                  </Badge>
                                );
                              })}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="hidden sm:flex gap-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                openAssignRole(account);
                              }}
                            >
                              <Plus className="h-3 w-3" />
                              {de ? 'Rolle' : 'Role'}
                            </Button>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-gray-400" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-gray-400" />
                            )}
                          </div>
                        </div>

                        {/* Expanded Detail */}
                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                              <div>
                                <span className="text-gray-500 dark:text-gray-400">
                                  {de ? 'E-Mail' : 'Email'}:
                                </span>
                                <p className="text-gray-700 dark:text-gray-300 mt-0.5 break-all">
                                  {account.email || '-'}
                                </p>
                              </div>
                              <div>
                                <span className="text-gray-500 dark:text-gray-400">
                                  {de ? 'Benutzer-ID' : 'User ID'}:
                                </span>
                                <p className="font-mono text-xs text-gray-700 dark:text-gray-300 mt-0.5 break-all">
                                  {account.user_id}
                                </p>
                              </div>
                              <div>
                                <span className="text-gray-500 dark:text-gray-400">
                                  {de ? 'Erstellt am' : 'Created at'}:
                                </span>
                                <p className="text-gray-700 dark:text-gray-300 mt-0.5">
                                  {account.created_at
                                    ? new Date(account.created_at).toLocaleDateString(de ? 'de-DE' : 'en-US', {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric',
                                      })
                                    : '-'}
                                </p>
                              </div>
                            </div>

                            <div>
                              <Label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
                                {de ? 'Tenant-Mitgliedschaften' : 'Tenant memberships'}
                              </Label>
                              <div className="flex flex-wrap gap-2">
                                {(membershipsByUser[account.user_id] ?? []).length > 0 ? (
                                  (membershipsByUser[account.user_id] ?? []).map((membership) => {
                                    const tenant = tenants.find((entry) => entry.id === membership.tenant_id);
                                    if (!tenant) return null;

                                    return (
                                      <Badge key={`${membership.tenant_id}-${membership.user_id}-detail`} variant="outline" className="gap-1">
                                        {tenant.name}
                                        {membership.is_tenant_admin ? ` · ${de ? 'Admin' : 'Admin'}` : ''}
                                      </Badge>
                                    );
                                  })
                                ) : (
                                  <Badge variant="outline" className="text-xs text-gray-400">
                                    {de ? 'Keine Tenant-Zuweisung' : 'No tenant assignment'}
                                  </Badge>
                                )}
                              </div>
                            </div>

                            {/* Roles with remove */}
                            <div>
                              <Label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
                                {de ? 'Zugewiesene Rollen' : 'Assigned Roles'}
                              </Label>
                              <div className="flex flex-wrap gap-2">
                                {account.roles.map((role) => (
                                  <Badge
                                    key={role.id}
                                    variant="secondary"
                                    className={`gap-1 pr-1 ${getRoleBadgeClass(role.name)}`}
                                  >
                                    {role.name}
                                    <button
                                      onClick={() => handleRemoveRole(account.user_id, role.id)}
                                      className="ml-1 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                                      title={de ? 'Rolle entfernen' : 'Remove role'}
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </Badge>
                                ))}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-xs gap-1"
                                  onClick={() => openAssignRole(account)}
                                >
                                  <Plus className="h-3 w-3" />
                                  {de ? 'Hinzufügen' : 'Add'}
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ ROLES TAB ═══ */}
        {activeTab === 'roles' && (
          <div className="space-y-6">
            {/* Roles Grid */}
            {roles.length === 0 ? (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-12 text-center">
                  <Shield className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">
                    {de ? 'Noch keine Rollen definiert.' : 'No roles defined yet.'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {roles.map((role) => {
                  const userCount = accounts.filter((a) =>
                    a.roles.some((r) => r.id === role.id)
                  ).length;
                  return (
                    <Card
                      key={role.id}
                      className="border-0 shadow-sm hover:shadow-md transition-shadow"
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-8 h-8 rounded-lg flex items-center justify-center ${getRoleBadgeClass(role.name)}`}
                            >
                              <Shield className="h-4 w-4" />
                            </div>
                            <CardTitle className="text-lg">{role.name}</CardTitle>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                          {role.description || (de ? 'Keine Beschreibung' : 'No description')}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <Users className="h-3.5 w-3.5" />
                          {userCount} {de ? (userCount === 1 ? 'Benutzer' : 'Benutzer') : (userCount === 1 ? 'user' : 'users')}
                        </div>
                        {role.app && role.app.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {role.app.map((a) => (
                              <Badge key={a} variant="outline" className="text-xs">
                                {a}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'tenants' && isSuperAdmin && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {de ? 'Tenants verwalten' : 'Manage tenants'}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {de
                    ? 'Workspaces erstellen, umbenennen und Benutzer als Mitglieder oder Tenant-Admins zuweisen.'
                    : 'Create workspaces, rename them, and assign users as members or tenant admins.'}
                </p>
              </div>
              <Dialog open={showCreateTenant} onOpenChange={setShowCreateTenant}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <Plus className="h-4 w-4" />
                    {de ? 'Neuen Tenant erstellen' : 'Create tenant'}
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>{de ? 'Tenant erstellen' : 'Create tenant'}</DialogTitle>
                    <DialogDescription>
                      {de
                        ? 'Lege einen neuen Workspace an. Der Slug wird für APIs und interne Zuordnungen verwendet.'
                        : 'Create a new workspace. The slug is used for API and internal references.'}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>{de ? 'Name' : 'Name'}</Label>
                      <Input value={newTenantName} onChange={(e) => setNewTenantName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Slug</Label>
                      <Input value={newTenantSlug} onChange={(e) => setNewTenantSlug(e.target.value)} placeholder={de ? 'Optional, wird sonst abgeleitet' : 'Optional, otherwise derived automatically'} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowCreateTenant(false)}>
                      {de ? 'Abbrechen' : 'Cancel'}
                    </Button>
                    <Button onClick={handleCreateTenant} disabled={submitting || !newTenantName.trim()}>
                      {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      {de ? 'Tenant erstellen' : 'Create tenant'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {tenants.length === 0 ? (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-12 text-center">
                  <Building2 className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">
                    {de ? 'Noch keine Tenants vorhanden.' : 'No tenants yet.'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {tenants.map((tenant) => {
                  const memberCount = tenantMemberships.filter((membership) => membership.tenant_id === tenant.id && membership.status === 'active').length;
                  const ownerAccount = tenant.default_for_user_id ? accountsById.get(tenant.default_for_user_id) : null;

                  return (
                    <Card key={tenant.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <CardTitle className="text-lg truncate">{tenant.name}</CardTitle>
                            <p className="text-sm text-gray-500 dark:text-gray-400 font-mono truncate">{tenant.slug}</p>
                          </div>
                          <Badge variant="outline">{memberCount} {de ? 'Mitglieder' : 'members'}</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                          <p>{de ? 'Tenant-ID' : 'Tenant ID'}: <span className="font-mono text-xs">{tenant.id}</span></p>
                          {ownerAccount && (
                            <p>{de ? 'Standard-Workspace von' : 'Default workspace for'}: {ownerAccount.Username || ownerAccount.email || ownerAccount.user_id}</p>
                          )}
                        </div>
                        <Button variant="outline" className="w-full gap-2" onClick={() => openManageTenant(tenant)}>
                          <UserCog className="h-4 w-4" />
                          {de ? 'Mitglieder verwalten' : 'Manage members'}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ DIALOGS ═══ */}

      {/* Assign Role Dialog */}
      <Dialog open={showAssignRole} onOpenChange={setShowAssignRole}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {de ? 'Rolle zuweisen' : 'Assign Role'}
            </DialogTitle>
            <DialogDescription>
              {de
                ? `Wählen Sie eine Rolle für "${selectedUser?.Username || selectedUser?.user_id}".`
                : `Select a role for "${selectedUser?.Username || selectedUser?.user_id}".`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{de ? 'Rolle' : 'Role'}</Label>
              <Select value={assignRoleId} onValueChange={setAssignRoleId}>
                <SelectTrigger>
                  <SelectValue placeholder={de ? 'Rolle wählen...' : 'Select role...'} />
                </SelectTrigger>
                <SelectContent>
                  {roles
                    .filter(
                      (r) => !selectedUser?.roles.some((ur) => ur.id === r.id)
                    )
                    .map((role) => (
                      <SelectItem key={role.id} value={String(role.id)}>
                        {role.name}
                        {role.description && (
                          <span className="text-gray-400 ml-2">— {role.description}</span>
                        )}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignRole(false)}>
              {de ? 'Abbrechen' : 'Cancel'}
            </Button>
            <Button onClick={handleAssignRole} disabled={submitting || !assignRoleId}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {de ? 'Zuweisen' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showManageTenant} onOpenChange={setShowManageTenant}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{de ? 'Tenant verwalten' : 'Manage tenant'}</DialogTitle>
            <DialogDescription>
              {selectedTenant
                ? (de ? `Mitglieder und Einstellungen für „${selectedTenant.name}“ verwalten.` : `Manage members and settings for "${selectedTenant.name}".`)
                : ''}
            </DialogDescription>
          </DialogHeader>

          {selectedTenant && (
            <div className="space-y-6 py-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{de ? 'Name' : 'Name'}</Label>
                  <Input value={tenantDraftName} onChange={(e) => setTenantDraftName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Slug</Label>
                  <Input value={tenantDraftSlug} onChange={(e) => setTenantDraftSlug(e.target.value)} />
                </div>
              </div>

              <div className="flex justify-end">
                <Button variant="outline" onClick={handleUpdateTenant} disabled={submitting || !tenantDraftName.trim()}>
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {de ? 'Workspace speichern' : 'Save workspace'}
                </Button>
              </div>

              <Separator />

              <div className="space-y-3">
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-white">{de ? 'Mitglied hinzufügen' : 'Add member'}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {de ? 'Bestehende Benutzerkonten diesem Tenant zuweisen.' : 'Assign existing user accounts to this tenant.'}
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-end">
                  <div className="space-y-2">
                    <Label>{de ? 'Benutzer' : 'User'}</Label>
                    <Select value={tenantMemberUserId} onValueChange={setTenantMemberUserId}>
                      <SelectTrigger>
                        <SelectValue placeholder={de ? 'Benutzer auswählen...' : 'Select user...'} />
                      </SelectTrigger>
                      <SelectContent>
                        {assignableAccountsForSelectedTenant.map((account) => (
                          <SelectItem key={account.user_id} value={account.user_id}>
                            {account.Username || account.email || account.user_id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
                    <Label htmlFor="tenant-admin-switch">{de ? 'Tenant-Admin' : 'Tenant admin'}</Label>
                    <Switch id="tenant-admin-switch" checked={tenantMemberAdmin} onCheckedChange={setTenantMemberAdmin} />
                  </div>
                  <Button onClick={handleAddTenantMember} disabled={submitting || !tenantMemberUserId}>
                    {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {de ? 'Hinzufügen' : 'Add'}
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-white">{de ? 'Aktuelle Mitglieder' : 'Current members'}</h3>
                </div>
                {membershipsForSelectedTenant.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {de ? 'Noch keine Mitglieder zugewiesen.' : 'No members assigned yet.'}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
                    {membershipsForSelectedTenant.map((membership) => {
                      const account = accountsById.get(membership.user_id);
                      return (
                        <div key={`${membership.tenant_id}-${membership.user_id}`} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{account?.Username || account?.email || membership.user_id}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{account?.email || membership.user_id}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{membership.status}</Badge>
                            <Button variant="outline" size="sm" onClick={() => void handleToggleTenantAdmin(membership)}>
                              {membership.is_tenant_admin ? (de ? 'Admin entfernen' : 'Remove admin') : (de ? 'Zum Admin machen' : 'Make admin')}
                            </Button>
                            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => void handleRemoveTenantMember(membership)}>
                              <UserMinus className="h-4 w-4 mr-1" />
                              {de ? 'Entfernen' : 'Remove'}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManageTenant(false)}>
              {de ? 'Schließen' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VerwaltungAccounts;
