/**
 * @deprecated Compatibility re-exports for pre-feature PageBuilder imports.
 * New code should import the legacy adapter from the PageBuilder feature.
 */
export {
  getLegacyProductPageContext as getProductPageData,
  saveLegacyProductPage as saveProductPage,
} from '@/features/page-builder/legacy/productPageService';
