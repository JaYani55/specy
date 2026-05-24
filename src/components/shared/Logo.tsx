import { useEffect, useState } from 'react';
import { useBranding } from '@/hooks/useBranding';

const DEFAULT_LOGO_URL = '/servicecms-transp.png';

const Logo = ({ className = "" }: { className?: string }) => {
  const { data: branding } = useBranding();
  const [src, setSrc] = useState(DEFAULT_LOGO_URL);

  useEffect(() => {
    setSrc(branding?.logoUrl || DEFAULT_LOGO_URL);
  }, [branding?.logoUrl]);

  return (
    <img
      src={src}
      alt="Service CMS Logo"
      className={`block h-12 w-auto max-w-full object-contain ${className}`}
      onError={() => setSrc(DEFAULT_LOGO_URL)}
    />
  );
};

export default Logo;