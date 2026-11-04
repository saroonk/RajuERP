import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;
}

interface Props {
  title: string;
  description?: string;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  /** Badge or status shown beside the title. */
  meta?: ReactNode;
}

export function PageHeader({ title, description, breadcrumbs, actions, meta }: Props) {
  return (
    <div className="no-print mb-6 md:mb-7">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-neutral-500">
          {breadcrumbs.map((c, i) => (
            <span key={c.label} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              {c.to ? (
                <Link to={c.to} className="transition-colors hover:text-neutral-900">
                  {c.label}
                </Link>
              ) : (
                <span className="font-medium text-neutral-700">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 md:text-[28px] md:leading-9">{title}</h1>
            {meta}
          </div>
          {description && <p className="mt-1.5 max-w-3xl text-sm text-neutral-500 md:text-[15px]">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
