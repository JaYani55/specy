import { Lock, Unlock } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useTheme } from '@/contexts/ThemeContext';

interface ObjectApiAccessControlsProps {
  apiEnabled: boolean;
  requiresAuth: boolean;
  onApiEnabledChange: (enabled: boolean) => void;
  onRequiresAuthChange: (required: boolean) => void;
  disabled?: boolean;
  idPrefix?: string;
}

/** Shared API visibility controls for manual Objects and generated Object datastreams. */
export function ObjectApiAccessControls({
  apiEnabled,
  requiresAuth,
  onApiEnabledChange,
  onRequiresAuthChange,
  disabled = false,
  idPrefix = 'object-api-access',
}: ObjectApiAccessControlsProps) {
  const { language } = useTheme();
  const apiEnabledId = `${idPrefix}-enabled`;
  const requiresAuthId = `${idPrefix}-requires-auth`;

  return (
    <>
      <div className="flex items-center gap-3 pt-6">
        <Switch id={apiEnabledId} checked={apiEnabled} onCheckedChange={onApiEnabledChange} disabled={disabled} />
        <Label htmlFor={apiEnabledId} className="flex cursor-pointer items-center gap-1.5">
          {language === 'en' ? 'API enabled' : 'API aktiviert'}
        </Label>
      </div>
      <div className="flex items-center gap-3 pt-6">
        <Switch id={requiresAuthId} checked={requiresAuth} onCheckedChange={onRequiresAuthChange} disabled={disabled} />
        <Label htmlFor={requiresAuthId} className="flex cursor-pointer items-center gap-1.5">
          {requiresAuth ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          {language === 'en' ? 'Require Auth JWT' : 'Auth JWT erforderlich'}
        </Label>
      </div>
    </>
  );
}
