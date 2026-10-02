import React from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { useNavigate, useLocation } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { Plus } from 'lucide-react';

// Import consistent admin components
import { AdminPageLayout } from '@/components/admin/ui';
import { BackButton } from '@/components/admin/ui';

// Import the ProductManagementModal component
import ProductManagementModal from '@/components/events/ProductManagementModal';

const VerwaltungCreateProduct = () => {
  const { language } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const permissions = usePermissions();

  React.useEffect(() => {
    if (!permissions.canManageProducts) {
      navigate('/products/schemas');
    }
  }, [permissions.canManageProducts, navigate]);

  // Keep legacy bookmarks and navigation state pointed at the consolidated routes.
  const getBackPath = () => {
    const requestedPath = location.state?.from;
    if (requestedPath === '/admin/all-products' || requestedPath === '/admin/create-product') {
      return '/products/manage';
    }
    if (requestedPath === '/admin') return '/products/manage';
    if (typeof requestedPath === 'string' && requestedPath.startsWith('/products')) return requestedPath;

    const referrer = document.referrer;
    if (referrer) {
      try {
        const referrerPath = new URL(referrer).pathname;
        if (referrerPath.includes('/admin/all-products') || referrerPath.includes('/admin/create-product') || referrerPath.startsWith('/products/manage')) {
          return '/products/manage';
        }
        if (referrerPath.startsWith('/admin')) return '/products/manage';
      } catch {
        // Use the product-management default when the referrer is unavailable or invalid.
      }
    }

    return '/products/manage';
  };

  const backPath = getBackPath();

  const handleCancel = () => {
    navigate(backPath);
  };

  const handleProductsChange = () => {
    // After successful creation, navigate back to where we came from
    navigate(backPath);
  };

  const getBackButtonLabel = () => {
    if (backPath === '/products/manage') {
      return language === 'en' ? 'Back to Products' : 'Zurück zu Produkten';
    }
    return language === 'en' ? 'Back to Products' : 'Zurück zu Produkten';
  };

  if (!permissions.canManageProducts) {
    return null;
  }

  return (
    <AdminPageLayout
      title={null}
      description={null}
      icon={null}
      actions={null}
    >
      <div className="flex items-center justify-start mb-6">
        <BackButton label={getBackButtonLabel()} onClick={() => navigate(backPath)} />
      </div>
      <ProductManagementModal 
        embedded={true}
        onProductsChange={handleProductsChange}
        onCancel={handleCancel}
        initialProduct={null}
      />
    </AdminPageLayout>
  );
};

export default VerwaltungCreateProduct;