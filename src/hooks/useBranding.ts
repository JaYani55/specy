import { useQuery } from '@tanstack/react-query';
import { BRANDING_QUERY_KEY, getBrandingSettings } from '@/services/brandingService';

export function useBranding() {
  return useQuery({
    queryKey: BRANDING_QUERY_KEY,
    queryFn: getBrandingSettings,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}