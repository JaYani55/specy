import { useEffect, useState } from 'react';
import { useBranding } from '@/hooks/useBranding';
import { DEFAULT_BRANDING_SETTINGS, type BrandingSettings } from '@/services/brandingService';

const DEFAULT_LOGO_URL = '/servicecms-transp_icon.png';

type LogoVariant = 'navbar' | 'sidebar' | 'login' | 'preview';

function getBaseLogoHeight(src: string, naturalWidth: number, naturalHeight: number, variant: LogoVariant): number {
  const fallbackHeights: Record<LogoVariant, number> = {
    navbar: 34,
    sidebar: 42,
    login: 56,
    preview: 40,
  };

  if (!naturalWidth || !naturalHeight) {
    return fallbackHeights[variant];
  }

  if (src === DEFAULT_LOGO_URL) {
    return fallbackHeights[variant];
  }

  const aspectRatio = naturalWidth / naturalHeight;

  if (variant === 'navbar') {
    if (aspectRatio <= 1.3) {
      return 42;
    }

    if (aspectRatio <= 2.2) {
      return 38;
    }

    return 34;
  }

  if (variant === 'sidebar') {
    if (aspectRatio <= 1.3) {
      return 50;
    }

    if (aspectRatio <= 2.2) {
      return 46;
    }

    return 42;
  }

  if (variant === 'login') {
    if (aspectRatio <= 1.3) {
      return 68;
    }

    if (aspectRatio <= 2.2) {
      return 62;
    }

    return 56;
  }

  if (aspectRatio <= 1.3) {
    return 68;
  }

  if (aspectRatio <= 2.2) {
    return 58;
  }

  return 48;
}

function resolveBrandingSettings(branding?: BrandingSettings, brandingOverride?: Partial<BrandingSettings>): BrandingSettings {
  return {
    ...(branding ?? DEFAULT_BRANDING_SETTINGS),
    ...(brandingOverride ?? {}),
  };
}

type LogoProps = {
  className?: string;
  brandingOverride?: Partial<BrandingSettings>;
  variant?: LogoVariant;
};

const Logo = ({ className = "", brandingOverride, variant = 'preview' }: LogoProps) => {
  const { data: branding } = useBranding();
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [loadError, setLoadError] = useState(false);

  const resolvedBranding = resolveBrandingSettings(branding, brandingOverride);
  const configuredSrc = resolvedBranding.logoMode === 'custom' && resolvedBranding.customLogoUrl
    ? resolvedBranding.customLogoUrl
    : DEFAULT_LOGO_URL;
  const effectiveSrc = loadError ? DEFAULT_LOGO_URL : configuredSrc;
  const baseHeight = getBaseLogoHeight(effectiveSrc, naturalSize.width, naturalSize.height, variant);
  const computedHeight = Math.round(baseHeight * (resolvedBranding.logoScale / 100));

  useEffect(() => {
    setLoadError(false);
    setNaturalSize({ width: 0, height: 0 });
  }, [configuredSrc]);

  return (
    <img
      src={effectiveSrc}
      alt="Service CMS Logo"
      className={`block w-auto max-w-full object-contain ${className}`}
      style={{ height: `${computedHeight}px` }}
      onLoad={(event) => {
        const image = event.currentTarget;
        setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
      }}
      onError={() => {
        if (configuredSrc !== DEFAULT_LOGO_URL) {
          setLoadError(true);
        }
      }}
    />
  );
};

export default Logo;