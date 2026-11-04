import { LinkButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';
import { Lock, SearchX } from 'lucide-react';

export function NotFoundPage() {
  return <EmptyState icon={<SearchX className="h-5 w-5" />} title="Page not found" description="The page you are looking for does not exist." action={<LinkButton to="/">Back to dashboard</LinkButton>} />;
}

export function ForbiddenPage() {
  return (
    <EmptyState
      icon={<Lock className="h-5 w-5" />}
      title="You don't have access to this area"
      description="Your role does not include this module. Ask an administrator if you need access."
      action={<LinkButton to="/">Back to dashboard</LinkButton>}
    />
  );
}
