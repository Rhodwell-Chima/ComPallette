import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { platformApi } from '../../services/api';
import { usePlatform } from '../PlatformContext';
import { NavigationDialog } from './NavigationDialog';
import { navigationControl } from './styles';

export function GlobalSearch() {
  const { selectedSiteId } = usePlatform();
  const { key } = useLocation();
  const navigate = useNavigate();
  const [openedAt, setOpenedAt] = useState<string>();
  const [value, setValue] = useState('');
  const [settledTerm, setSettledTerm] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const openedFrom = useRef(key);
  const open = openedAt === key;
  const term = value.trim();
  const canSearch = Boolean(selectedSiteId) && term.length > 1;
  const waiting = term !== settledTerm;

  useEffect(() => {
    if (!open || !canSearch) {
      setSettledTerm('');
      return;
    }
    const timeout = window.setTimeout(() => setSettledTerm(term), 150);
    return () => window.clearTimeout(timeout);
  }, [open, canSearch, term]);

  const results = useQuery({
    queryKey: ['navbar-search', selectedSiteId, settledTerm],
    queryFn: () => platformApi.search(selectedSiteId, settledTerm),
    enabled: open && canSearch && !waiting,
    staleTime: 15_000,
  });

  useEffect(() => {
    setOpenedAt(undefined);
    setValue('');
  }, [key]);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      if (document.querySelector('[role="dialog"]:not([inert]), [role="menu"]')) return;
      event.preventDefault();
      openedFrom.current = key;
      setOpenedAt(key);
    }
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [key]);

  const matches = canSearch && !waiting && !results.isError ? results.data?.results ?? [] : [];
  const message = !selectedSiteId ? 'Select a site to search.'
    : !canSearch ? 'Enter at least two characters.'
    : waiting || results.isPending ? 'Searching…'
    : results.isError ? 'Search is unavailable. Try again.'
    : matches.length === 0 ? 'No matching records.' : '';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (matches[0]) navigate(matches[0].route);
  }

  return (
    <Dialog.Root open={open} onOpenChange={next => {
      if (next) openedFrom.current = key;
      else setValue('');
      setOpenedAt(next ? key : undefined);
    }}>
      <Dialog.Trigger
        className={navigationControl({ layout: 'utility' })}
        aria-label="Search records"
        aria-keyshortcuts="Control+K Meta+K"
        title="Search records (Ctrl+K or Command+K)"
      >
        <Search size={18} aria-hidden="true" /><span className="nav-search-text">Search</span>
      </Dialog.Trigger>
      <NavigationDialog
        open={open}
        title="Search site records"
        onOpenAutoFocus={event => {
          event.preventDefault();
          input.current?.focus();
        }}
        onCloseAutoFocus={event => {
          if (openedFrom.current !== key) {
            event.preventDefault();
            document.getElementById('main-content')?.focus({ preventScroll: true });
          }
        }}
      >
        <form role="search" className="nav-search-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="nav-search-input">Search devices, personnel, assets, and zones</label>
          <input
            id="nav-search-input"
            ref={input}
            type="search"
            placeholder="Devices, personnel, assets, or zones"
            value={value}
            onChange={event => setValue(event.target.value)}
          />
        </form>
        <div className="nav-search-results">
          <p className={message ? 'nav-search-message' : 'sr-only'} role="status">{message || `${matches.length} search results`}</p>
          {results.isError && canSearch && !waiting && (
            <button className={navigationControl({ layout: 'row' })} type="button" onClick={() => void results.refetch()}>Retry search</button>
          )}
          {matches.length > 0 && (
            <ul className="nav-list">
              {matches.map(result => (
                <li key={`${result.kind}:${result.id}`}>
                  <Link className={navigationControl({ layout: 'row' })} to={result.route} tabIndex={0}>
                    <span className="min-w-0 grow wrap-anywhere">{result.label}</span>
                    <span className="shrink-0 text-xs capitalize text-nav-muted">{result.kind}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </NavigationDialog>
    </Dialog.Root>
  );
}
