import { useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/Confirm';
import { Input } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/States';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { services } from '@/services';

/** Add, rename and delete expense categories. The service refuses to delete a category that has expenses. */
export function CategoriesManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Expense categories" description="Categories group expenses in the income & expense summary." size="sm">
      {open && <Body />}
    </Modal>
  );
}

function Body() {
  const list = useData(() => services.accounts.expenseCategories.list());
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');

  const add = async () => {
    if (!name.trim()) return setError('Enter a category name');
    setError('');
    const res = await run(() => services.accounts.expenseCategories.create({ name: name.trim() }), 'Category added');
    if (res) setName('');
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) return setError('Category name cannot be empty');
    setError('');
    const res = await run(() => services.accounts.expenseCategories.update(editing.id, { name: editing.name.trim() }), 'Category renamed');
    if (res) setEditing(null);
  };

  const remove = async (id: string, label: string) => {
    if (await confirm({ title: 'Delete category?', message: `"${label}" will be removed. Categories that already have expenses cannot be deleted.`, confirmLabel: 'Delete', danger: true })) {
      await run(() => services.accounts.expenseCategories.remove(id), 'Category deleted');
    }
  };

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input aria-label="New category name" placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" loading={busy && !editing}>Add</Button>
      </form>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {list.loading ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl ring-1 ring-slate-900/[0.07]">
          {(list.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-2 p-2.5">
              {editing?.id === c.id ? (
                <>
                  <Input aria-label="Category name" autoFocus value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void save()} />
                  <button className="rounded-md p-2 text-emerald-700 hover:bg-neutral-100" aria-label="Save name" onClick={() => void save()}><Check className="h-4 w-4" /></button>
                  <button className="rounded-md p-2 text-neutral-500 hover:bg-neutral-100" aria-label="Cancel rename" onClick={() => { setEditing(null); setError(''); }}><X className="h-4 w-4" /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{c.name}</span>
                  <button className="rounded-md p-2 text-neutral-500 hover:bg-neutral-100" aria-label={`Rename ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name })}><Pencil className="h-4 w-4" /></button>
                  <button className="rounded-md p-2 text-red-600 hover:bg-neutral-100" aria-label={`Delete ${c.name}`} onClick={() => void remove(c.id, c.name)}><Trash2 className="h-4 w-4" /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
