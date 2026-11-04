import type {
  BrandReportRow,
  DashboardSummary,
  DistributorPerfRow,
  GstSummary,
  ProductPerfRow,
  PurchaseRegisterRow,
  SalesProfitReport,
  SalesRegisterRow,
} from '@/types';
import type { ReportsService, Services } from '../types';
import { api, asArray } from './client';

const range = (r: { from: string; to: string }) => ({ from: r.from, to: r.to });
/** Report endpoints return full result sets; tolerate a paged envelope as well. */
const rows = async <T>(path: string, r: { from: string; to: string }): Promise<T[]> => asArray(await api.get<T[]>(path, range(r)));

export const reports: ReportsService = {
  salesProfitability: (r) => api.get<SalesProfitReport>('reports/sales-profitability/', range(r)),
  brands: (r) => rows<BrandReportRow>('reports/brands/', r),
  products: (r) => rows<ProductPerfRow>('reports/products/', r),
  distributors: (r) => rows<DistributorPerfRow>('reports/distributors/', r),
  purchaseRegister: (r) => rows<PurchaseRegisterRow>('reports/purchase-register/', r),
  salesRegister: (r) => rows<SalesRegisterRow>('reports/sales-register/', r),
  gstSummary: (r) => api.get<GstSummary>('reports/gst-summary/', range(r)),
};

export const dashboard: Services['dashboard'] = { summary: () => api.get<DashboardSummary>('dashboard/') };
