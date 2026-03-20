import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useNavigate } from 'react-router-dom';
import {
  fetchRoles,
  fetchAccounts,
  createRole,
  updateRole,
  deleteRole,
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
import { toast } from 'sonner';
import {
  Shield,
  UserPlus,
  Plus,
  Trash2,
  Pencil,
  Users,
  ShieldCheck,
  Loader2,
  ArrowLeft,
  X,
  ChevronDown,
  ChevronUp,
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
  const [activeTab, setActiveTab] = useState<'accounts' | 'roles'>('accounts');

  // Dialog states
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [showEditRole, setShowEditRole] = useState(false);
  const [showDeleteRole, setShowDeleteRole] = useState(false);
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [showAssignRole, setShowAssignRole] = useState(false);

  // Selected items
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [selectedUser, setSelectedUser] = useState<AccountUser | null>(null);

  // Expanded user cards
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

  // Form states
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newAccountRoleIds, setNewAccountRoleIds] = useState<number[]>([]);
  const [assignRoleId, setAssignRoleId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  const de = language === 'de';

  // ─── Data Loading ───────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [rolesData, accountsData] = await Promise.all([
        fetchRoles(),
        fetchAccounts(),
      ]);
      setRoles(rolesData);
      setAccounts(accountsData);
    } catch (err) {
      console.error('Failed to load account data:', err);
      toast.error(de ? 'Fehler beim Laden der Kontodaten' : 'Failed to load account data');
    } finally {
      setLoading(false);
    }
  }, [de]);

  useEffect(() => {
    if (!permissions.canManageAccounts) {
      navigate('/verwaltung');
      return;
    }
    loadData();
  }, [permissions.canManageAccounts, navigate, loadData]);

  // ─── Role CRUD Handlers ─────────────────────────────────────────

  const handleCreateRole = async () => {
    if (!newRoleName.trim()) return;
    setSubmitting(true);
    try {
      await createRole({ name: newRoleName.trim(), description: newRoleDescription.trim() || undefined });
      toast.success(de ? 'Rolle erstellt' : 'Role created');
      setShowCreateRole(false);
      setNewRoleName('');
      setNewRoleDescription('');
      await loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, de ? 'Fehler beim Erstellen' : 'Error creating role'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateRole = async () => {
    if (!selectedRole || !newRoleName.trim()) return;
    setSubmitting(true);
    try {
      await updateRole(selectedRole.id, {
        name: newRoleName.trim(),
        description: newRoleDescription.trim() || undefined,
      });
      toast.success(de ? 'Rolle aktualisiert' : 'Role updated');
      setShowEditRole(false);
      setSelectedRole(null);
      setNewRoleName('');
      setNewRoleDescription('');
      await loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, de ? 'Fehler beim Aktualisieren' : 'Error updating role'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!selectedRole) return;
    setSubmitting(true);
    try {
      await deleteRole(selectedRole.id);
      toast.success(de ? 'Rolle gelöscht' : 'Role deleted');
      setShowDeleteRole(false);
      setSelectedRole(null);
      await loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, de ? 'Fehler beim Löschen' : 'Error deleting role'));
    } finally {
      setSubmitting(false);
    }
  };

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

  // ─── Helpers ────────────────────────────────────────────────────

  const toggleUserExpanded = (userId: string) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const openEditRole = (role: Role) => {
    setSelectedRole(role);
    setNewRoleName(role.name);
    setNewRoleDescription(role.description || '');
    setShowEditRole(true);
  };

  const openDeleteRole = (role: Role) => {
    setSelectedRole(role);
    setShowDeleteRole(true);
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
            onClick={() => navigate('/verwaltung')}
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
                  ? 'Benutzerkonten, Rollen und Zugriffsrechte verwalten'
                  : 'Manage user accounts, roles and access permissions'}
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
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900 dark:text-white truncate">
                                {account.Username || (de ? 'Kein Benutzername' : 'No username')}
                              </span>
                              {account.email && (
                                <span className="text-sm text-gray-500 dark:text-gray-400 truncate hidden sm:inline">
                                  {account.email}
                                </span>
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
            {/* Actions Bar */}
            <div className="flex justify-end">
              <Dialog open={showCreateRole} onOpenChange={setShowCreateRole}>
                <DialogTrigger asChild>
                  <Button className="gap-2 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700">
                    <Plus className="h-4 w-4" />
                    {de ? 'Neue Rolle erstellen' : 'Create New Role'}
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>{de ? 'Neue Rolle erstellen' : 'Create New Role'}</DialogTitle>
                    <DialogDescription>
                      {de
                        ? 'Definieren Sie eine neue Rolle für die Zugriffskontrolle.'
                        : 'Define a new role for access control.'}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>{de ? 'Rollenname' : 'Role Name'} *</Label>
                      <Input
                        placeholder={de ? 'z.B. editor, viewer' : 'e.g. editor, viewer'}
                        value={newRoleName}
                        onChange={(e) => setNewRoleName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{de ? 'Beschreibung' : 'Description'}</Label>
                      <Textarea
                        placeholder={de ? 'Beschreibung der Rolle...' : 'Role description...'}
                        value={newRoleDescription}
                        onChange={(e) => setNewRoleDescription(e.target.value)}
                        rows={3}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowCreateRole(false)}>
                      {de ? 'Abbrechen' : 'Cancel'}
                    </Button>
                    <Button onClick={handleCreateRole} disabled={submitting || !newRoleName.trim()}>
                      {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      {de ? 'Erstellen' : 'Create'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

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
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEditRole(role)}
                              title={de ? 'Bearbeiten' : 'Edit'}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                              onClick={() => openDeleteRole(role)}
                              title={de ? 'Löschen' : 'Delete'}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
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
      </div>

      {/* ═══ DIALOGS ═══ */}

      {/* Edit Role Dialog */}
      <Dialog open={showEditRole} onOpenChange={setShowEditRole}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{de ? 'Rolle bearbeiten' : 'Edit Role'}</DialogTitle>
            <DialogDescription>
              {de ? 'Rollendetails aktualisieren.' : 'Update role details.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{de ? 'Rollenname' : 'Role Name'} *</Label>
              <Input
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{de ? 'Beschreibung' : 'Description'}</Label>
              <Textarea
                value={newRoleDescription}
                onChange={(e) => setNewRoleDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditRole(false)}>
              {de ? 'Abbrechen' : 'Cancel'}
            </Button>
            <Button onClick={handleUpdateRole} disabled={submitting || !newRoleName.trim()}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {de ? 'Speichern' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Role Confirmation */}
      <AlertDialog open={showDeleteRole} onOpenChange={setShowDeleteRole}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {de ? 'Rolle löschen?' : 'Delete Role?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {de
                ? `Die Rolle "${selectedRole?.name}" wird unwiderruflich gelöscht. Alle Benutzerzuweisungen werden ebenfalls entfernt.`
                : `The role "${selectedRole?.name}" will be permanently deleted. All user assignments will also be removed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{de ? 'Abbrechen' : 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRole}
              className="bg-red-600 hover:bg-red-700"
            >
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {de ? 'Löschen' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    </div>
  );
};

export default VerwaltungAccounts;
