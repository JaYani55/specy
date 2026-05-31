import React from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

// Import consistent admin components
import { AdminPageLayout } from '@/components/admin/ui';
import { BackButton } from '@/components/admin/ui';
import { AdminCard, SaveButton, CancelButton } from '@/components/admin/ui';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ImageUploader } from '@/components/pagebuilder/ImageUploader';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchAccounts, type AccountUser } from '@/services/accountService';
import { createStaffRecord, fetchStaffRecord, updateStaffRecord } from '@/services/staffRegistryService';
import { getTenantOptions, pickInitialTenantId, type TenantOption } from '@/services/tenantService';

interface StaffFormState {
  displayName: string;
  email: string;
  phone: string;
  avatarUrl: string;
  jobTitle: string;
  notes: string;
  status: 'active' | 'inactive' | 'archived';
  accountUserId: string;
}

const VerwaltungAddMentor = () => {
  const { language } = useTheme();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editingStaffId = searchParams.get('edit');
  const isEditing = Boolean(editingStaffId);
  const [accounts, setAccounts] = React.useState<AccountUser[]>([]);
  const [tenantOptions, setTenantOptions] = React.useState<TenantOption[]>([]);
  const [tenantId, setTenantId] = React.useState('');
  const [tenantOptionsLoading, setTenantOptionsLoading] = React.useState(true);
  const [hasTenantAdminAccess, setHasTenantAdminAccess] = React.useState(false);
  const [loadingAccounts, setLoadingAccounts] = React.useState(true);
  const [loadingStaff, setLoadingStaff] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [formState, setFormState] = React.useState<StaffFormState>({
    displayName: '',
    email: '',
    phone: '',
    avatarUrl: '',
    jobTitle: '',
    notes: '',
    status: 'active',
    accountUserId: 'none',
  });

  const canManageStaff = permissions.canManageMentors || hasTenantAdminAccess;
  const manageableTenantOptions = React.useMemo(
    () => (permissions.canManageMentors ? tenantOptions : tenantOptions.filter((option) => option.is_tenant_admin)),
    [permissions.canManageMentors, tenantOptions],
  );

  React.useEffect(() => {
    const loadTenantOptions = async () => {
      try {
        setTenantOptionsLoading(true);
        const options = await getTenantOptions();
        setTenantOptions(options);
        setHasTenantAdminAccess(options.some((option) => option.is_tenant_admin));

        const selectableOptions = permissions.canManageMentors
          ? options
          : options.filter((option) => option.is_tenant_admin);

        setTenantId((current) => pickInitialTenantId(selectableOptions, current));
      } catch (error) {
        console.error('Error loading tenant options:', error);
        setTenantOptions([]);
        setHasTenantAdminAccess(false);
      } finally {
        setTenantOptionsLoading(false);
      }
    };

    void loadTenantOptions();
  }, [permissions.canManageMentors]);

  React.useEffect(() => {
    if (!tenantOptionsLoading && !canManageStaff) {
      navigate('/admin');
    }
  }, [tenantOptionsLoading, canManageStaff, navigate]);

  React.useEffect(() => {
    const loadAccounts = async () => {
      try {
        setLoadingAccounts(true);
        const data = await fetchAccounts();
        setAccounts(data);
      } catch (error) {
        console.error('Error loading accounts:', error);
        toast.error(language === 'en' ? 'Failed to load accounts' : 'Fehler beim Laden der Konten');
      } finally {
        setLoadingAccounts(false);
      }
    };

    void loadAccounts();
  }, [language]);

  React.useEffect(() => {
    if (!editingStaffId) {
      return;
    }

    const loadStaff = async () => {
      try {
        setLoadingStaff(true);
        const staff = await fetchStaffRecord(editingStaffId);

        if (!staff) {
          toast.error(language === 'en' ? 'Staff member not found' : 'Mitarbeiter nicht gefunden');
          navigate('/admin/all-mentors');
          return;
        }

        setFormState({
          displayName: staff.displayName || '',
          email: staff.email || '',
          phone: staff.phone || '',
          avatarUrl: staff.avatarUrl || '',
          jobTitle: staff.jobTitle || '',
          notes: staff.notes || '',
          status: staff.status,
          accountUserId: staff.accountUserId || 'none',
        });
        setTenantId((current) => staff.tenantId || pickInitialTenantId(manageableTenantOptions, current));
      } catch (error) {
        console.error('Error loading staff record:', error);
        toast.error(language === 'en' ? 'Failed to load staff member' : 'Fehler beim Laden des Mitarbeiters');
        navigate('/admin/all-mentors');
      } finally {
        setLoadingStaff(false);
      }
    };

    void loadStaff();
  }, [editingStaffId, language, manageableTenantOptions, navigate]);

  React.useEffect(() => {
    if (editingStaffId) {
      return;
    }
    if (tenantOptionsLoading) {
      return;
    }

    setTenantId((current) => pickInitialTenantId(manageableTenantOptions, current));
  }, [editingStaffId, manageableTenantOptions, tenantOptionsLoading]);

  const handleSaveStaff = async () => {
    if (!formState.displayName.trim()) {
      toast.error(language === 'en' ? 'Display name is required' : 'Name ist erforderlich');
      return;
    }

    if (manageableTenantOptions.length > 0 && !tenantId) {
      toast.error(language === 'en' ? 'Please select a workspace' : 'Bitte waehlen Sie einen Workspace aus');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        displayName: formState.displayName.trim(),
        tenantId: tenantId || null,
        accountUserId: formState.accountUserId === 'none' ? null : formState.accountUserId,
        email: formState.email.trim() || null,
        phone: formState.phone.trim() || null,
        avatarUrl: formState.avatarUrl.trim() || null,
        jobTitle: formState.jobTitle.trim() || null,
        notes: formState.notes.trim() || null,
        status: formState.status,
      };

      if (editingStaffId) {
        await updateStaffRecord(editingStaffId, payload);
      } else {
        await createStaffRecord(payload);
      }

      toast.success(language === 'en'
        ? isEditing ? 'Staff member updated' : 'Staff member created'
        : isEditing ? 'Mitarbeiter aktualisiert' : 'Mitarbeiter erstellt');
      navigate('/admin/all-mentors');
    } catch (error) {
      console.error('Error saving staff record:', error);
      toast.error(language === 'en'
        ? isEditing ? 'Failed to update staff member' : 'Failed to create staff member'
        : isEditing ? 'Fehler beim Aktualisieren des Mitarbeiters' : 'Fehler beim Erstellen des Mitarbeiters');
    } finally {
      setSaving(false);
    }
  };

  if (!tenantOptionsLoading && !canManageStaff) {
    return null;
  }

  if (loadingStaff) {
    return (
      <AdminPageLayout
        title={language === 'en' ? 'Edit Staff Member' : 'Mitarbeiter bearbeiten'}
        icon={UserPlus}
        actions={
          <BackButton
            label={language === 'en' ? 'Back to Staff' : 'Zurueck zu Mitarbeitern'}
            onClick={() => navigate('/admin/all-mentors')}
          />
        }
      >
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          {language === 'en' ? 'Loading staff member...' : 'Mitarbeiter wird geladen...'}
        </div>
      </AdminPageLayout>
    );
  }

  return (
    <AdminPageLayout
      title={language === 'en'
        ? isEditing ? 'Edit Staff Member' : 'Add New Staff Member'
        : isEditing ? 'Mitarbeiter bearbeiten' : 'Neuen Mitarbeiter hinzufügen'}
      description={language === 'en' 
        ? isEditing
          ? 'Update the staff profile, including the avatar stored in the media library.'
          : 'Create a new staff profile and add them to the platform'
        : isEditing
          ? 'Aktualisieren Sie das Mitarbeiterprofil inklusive Avatar aus der Media Library.'
          : 'Neues Mitarbeiterprofil erstellen und zur Plattform hinzufügen'}
      icon={UserPlus}
      actions={
        <BackButton 
          label={language === 'en' ? 'Back to Staff' : 'Zurueck zu Mitarbeitern'}
          onClick={() => navigate('/admin/all-mentors')}
        />
      }
    >
      <AdminCard>
        <div className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{language === 'en' ? 'Display name' : 'Anzeigename'} *</Label>
              <Input
                value={formState.displayName}
                onChange={(e) => setFormState((prev) => ({ ...prev, displayName: e.target.value }))}
                placeholder={language === 'en' ? 'e.g. Alex Example' : 'z. B. Alex Beispiel'}
              />
            </div>

            <div className="space-y-2">
              <Label>{language === 'en' ? 'Link ServiceCRM account' : 'ServiceCRM-Konto verknüpfen'}</Label>
              <Select
                value={formState.accountUserId}
                onValueChange={(value) => setFormState((prev) => ({ ...prev, accountUserId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={language === 'en' ? 'Optional account' : 'Optionales Konto'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{language === 'en' ? 'No linked account' : 'Kein verknüpftes Konto'}</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.user_id} value={account.user_id}>
                      {account.Username || account.user_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {loadingAccounts && (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {language === 'en' ? 'Loading available accounts...' : 'Verfügbare Konten werden geladen...'}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>{language === 'en' ? 'Workspace' : 'Workspace'}</Label>
              <Select
                value={tenantId}
                onValueChange={setTenantId}
                disabled={tenantOptionsLoading || manageableTenantOptions.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={language === 'en' ? 'Select workspace...' : 'Workspace auswählen...'} />
                </SelectTrigger>
                <SelectContent>
                  {manageableTenantOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}{option.is_default ? (language === 'en' ? ' (default)' : ' (Standard)') : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>{language === 'en' ? 'Profile picture' : 'Profilbild'}</Label>
              <ImageUploader
                value={formState.avatarUrl}
                onChange={(url) => setFormState((prev) => ({ ...prev, avatarUrl: url }))}
                previewVariant="avatar"
                folder="staff/avatars"
              />
              <Input
                value={formState.avatarUrl}
                readOnly
                placeholder={language === 'en' ? 'Selected image URL will be saved to the staff table' : 'Die gewaehlte Bild-URL wird in der Staff-Tabelle gespeichert'}
              />
              <p className="text-xs text-muted-foreground">
                {language === 'en'
                  ? 'Uses the configured media library bucket and stores the public URL in the staff record.'
                  : 'Verwendet den konfigurierten Media-Library-Bucket und speichert die oeffentliche URL im Staff-Datensatz.'}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{language === 'en' ? 'Email' : 'E-Mail'}</Label>
              <Input
                type="email"
                value={formState.email}
                onChange={(e) => setFormState((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="name@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label>{language === 'en' ? 'Phone' : 'Telefon'}</Label>
              <Input
                value={formState.phone}
                onChange={(e) => setFormState((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder={language === 'en' ? 'Optional phone number' : 'Optionale Telefonnummer'}
              />
            </div>

            <div className="space-y-2">
              <Label>{language === 'en' ? 'Job title' : 'Rolle/Funktion'}</Label>
              <Input
                value={formState.jobTitle}
                onChange={(e) => setFormState((prev) => ({ ...prev, jobTitle: e.target.value }))}
                placeholder={language === 'en' ? 'e.g. Team Lead' : 'z. B. Team Lead'}
              />
            </div>

            <div className="space-y-2">
              <Label>{language === 'en' ? 'Status' : 'Status'}</Label>
              <Select
                value={formState.status}
                onValueChange={(value: 'active' | 'inactive' | 'archived') => setFormState((prev) => ({ ...prev, status: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{language === 'en' ? 'Active' : 'Aktiv'}</SelectItem>
                  <SelectItem value="inactive">{language === 'en' ? 'Inactive' : 'Inaktiv'}</SelectItem>
                  <SelectItem value="archived">{language === 'en' ? 'Archived' : 'Archiviert'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{language === 'en' ? 'Notes' : 'Notizen'}</Label>
            <Textarea
              value={formState.notes}
              onChange={(e) => setFormState((prev) => ({ ...prev, notes: e.target.value }))}
              rows={5}
              placeholder={language === 'en' ? 'Internal notes about this staff member' : 'Interne Notizen zu diesem Mitarbeiter'}
            />
          </div>

          <div className="flex justify-end gap-3">
            <CancelButton onClick={() => navigate('/admin/all-mentors')}>
              {language === 'en' ? 'Cancel' : 'Abbrechen'}
            </CancelButton>
            <SaveButton onClick={handleSaveStaff} disabled={saving || !formState.displayName.trim()} loading={saving}>
              {language === 'en'
                ? isEditing ? 'Save changes' : 'Create staff member'
                : isEditing ? 'Aenderungen speichern' : 'Mitarbeiter erstellen'}
            </SaveButton>
          </div>
        </div>
      </AdminCard>
    </AdminPageLayout>
  );
};

export default VerwaltungAddMentor;