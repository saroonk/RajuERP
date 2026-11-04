import { Suspense, useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronRight, LogOut, Menu as MenuIcon, Search, X } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { findNav } from '@/app/nav';
import { Menu } from '@/components/ui/Menu';
import { Spinner } from '@/components/ui/States';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import { titleCase } from '@/utils/format';
import { GlobalSearch } from './GlobalSearch';
import { Sidebar } from './Sidebar';

export function AppLayout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const alerts = useData(() => services.inventory.alerts());
  const nav = findNav(pathname);

  useEffect(() => {
    setDrawer(false);
    setMobileSearch(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawer]);

  useEffect(() => {
    document.title = nav ? `${nav.item.label} · RajuERP` : 'RajuERP';
  }, [nav]);

  const count = alerts.data?.total ?? 0;

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-3 left-3 z-30 hidden w-60 overflow-hidden rounded-3xl shadow-float ring-1 ring-white/10 lg:block">
        <Sidebar />
      </aside>

      {/* Mobile / tablet drawer */}
      {drawer && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="absolute inset-0 animate-fade-in bg-neutral-950/60 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-hidden rounded-r-3xl shadow-xl">
            <Sidebar onNavigate={() => setDrawer(false)} onClose={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-[16.5rem] print:pl-0">
        <header className="no-print glass sticky top-3 z-20 mx-3 mt-3 rounded-2xl md:mx-6 xl:mx-8">
          <div className="flex h-14 items-center gap-2 px-3 md:h-16 md:px-5">
            <button onClick={() => setDrawer(true)} className="-ml-1 rounded-md p-2 text-neutral-700 hover:bg-neutral-100 lg:hidden" aria-label="Open menu">
              <MenuIcon className="h-5 w-5" />
            </button>
            <div className="hidden min-w-0 items-center gap-1 text-sm text-neutral-500 md:flex">
              {nav ? (
                <>
                  <span>{nav.group.label}</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                  <span className="truncate font-semibold text-neutral-900">{nav.item.label}</span>
                </>
              ) : (
                <span className="font-medium text-neutral-900">RajuERP</span>
              )}
            </div>
            <p className="truncate text-sm font-medium text-neutral-900 md:hidden">{nav?.item.label ?? 'RajuERP'}</p>

            <div className="ml-auto flex items-center gap-1 md:gap-2">
              <GlobalSearch className="hidden w-72 md:block xl:w-96" />
              <button onClick={() => setMobileSearch((s) => !s)} className="rounded-md p-2 text-neutral-700 hover:bg-neutral-100 md:hidden" aria-label={mobileSearch ? 'Close search' : 'Open search'}>
                {mobileSearch ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
              </button>
              <Link to="/alerts" className="relative rounded-full p-2.5 text-neutral-600 transition-colors hover:bg-slate-900/[0.06] hover:text-neutral-900" aria-label={`Alerts${count ? `, ${count} open` : ''}`}>
                <Bell className="h-5 w-5" />
                {count > 0 && <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white ring-2 ring-white">{count > 99 ? '99+' : count}</span>}
              </Link>
              <Menu
                label="Account menu"
                trigger={
                  <span className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-slate-900/[0.06]">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-b from-[#2b303b] to-ink text-xs font-semibold text-white shadow-sm ring-2 ring-white">{user?.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                    <span className="hidden text-left leading-tight sm:block">
                      <span className="block text-xs font-medium text-neutral-900">{user?.name}</span>
                      <span className="block text-[11px] text-neutral-500">{titleCase(user?.role ?? '')}</span>
                    </span>
                  </span>
                }
                items={[
                  {
                    label: 'Sign out',
                    icon: <LogOut className="h-4 w-4" />,
                    onClick: async () => {
                      await logout();
                      navigate('/login', { replace: true });
                    },
                  },
                ]}
              />
            </div>
          </div>
          {mobileSearch && (
            <div className="border-t border-slate-900/5 p-3 md:hidden">
              <GlobalSearch autoFocus />
            </div>
          )}
        </header>

        <main id="main" className="mx-auto w-full max-w-[1440px] px-4 pb-10 pt-6 md:px-6 md:pt-8 xl:px-8 print:max-w-none print:p-0">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
