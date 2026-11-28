import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ColumnDef, DataTableProps, SortDirection } from './types';
import { microGestures } from '../motion';
import { Skeleton } from '../loading';

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  emptyMessage = 'No records found matching criteria',
  sortState,
  onSortChange,
  selectedIds,
  onSelectionChange,
  renderBulkActions,
  renderToolbar,
  density: propDensity,
  onDensityChange,
  className = '',
  columnPreferenceKey,
}: DataTableProps<T>) {
  const [internalDensity, setInternalDensity] = useState<'compact' | 'comfortable'>('compact');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    if (columnPreferenceKey) {
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(columnPreferenceKey) ?? 'null');
        if (Array.isArray(saved) && saved.every(value => typeof value === 'string')) return saved;
      } catch { /* The table still has defaults. */ }
    }
    return columns.map(column => column.key);
  });
  const [showColPicker, setShowColPicker] = useState(false);

  const density = propDensity || internalDensity;
  const setDensity = onDensityChange || setInternalDensity;

  const activeColumns = useMemo(() => {
    return columns.filter((c) => c.required || visibleColumns.includes(c.key));
  }, [columns, visibleColumns]);

  const allSelected = useMemo(() => {
    if (!data.length || !selectedIds) return false;
    return data.every((row) => selectedIds.includes(keyExtractor(row)));
  }, [data, selectedIds, keyExtractor]);

  const isIndeterminate = useMemo(() => {
    if (!selectedIds?.length || !data.length) return false;
    return selectedIds.length > 0 && !allSelected;
  }, [selectedIds, allSelected, data.length]);

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(data.map(keyExtractor));
    }
  };

  const handleSelectRow = (id: string | number) => {
    if (!onSelectionChange || !selectedIds) return;
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((item) => item !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  const handleHeaderClick = (col: ColumnDef<T>) => {
    if (!col.sortable || !onSortChange) return;
    let nextDirection: SortDirection = 'asc';
    if (sortState?.field === col.key) {
      if (sortState.direction === 'asc') nextDirection = 'desc';
      else if (sortState.direction === 'desc') nextDirection = null;
    }
    onSortChange({ field: nextDirection ? col.key : '', direction: nextDirection });
  };

  const rowPadding = density === 'compact' ? '0.55rem 0.85rem' : '0.85rem 1rem';
  const fontSize = density === 'compact' ? '0.84rem' : '0.90rem';

  return (
    <div className={`data-table-container ${className}`} style={{ width: '100%' }}>
      {/* Table Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div style={{ flex: 1, minWidth: '240px' }}>{renderToolbar?.()}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative' }}>
          {/* Density Toggle */}
          <button
            type="button"
            onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
            title={`Switch to ${density === 'compact' ? 'comfortable' : 'compact'} view`}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.4rem 0.65rem',
              color: 'var(--muted)',
              fontSize: '0.78rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              transition: 'all 0.15s ease',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            <span>{density === 'compact' ? 'Compact' : 'Comfortable'}</span>
          </button>

          {/* Column Visibility Menu */}
          <button
            type="button"
            onClick={() => setShowColPicker(!showColPicker)}
            title="Configure visible columns"
            aria-expanded={showColPicker}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.4rem 0.65rem',
              color: 'var(--muted)',
              fontSize: '0.78rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              transition: 'all 0.15s ease',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span>Columns</span>
          </button>

          {showColPicker && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '110%',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '0.65rem',
                zIndex: 25,
                boxShadow: '0 12px 30px rgba(0, 0, 0, 0.2)',
                minWidth: '170px',
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.4rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Visible Columns
              </div>
              {columns.map((col) => (
                <label
                  key={col.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '0.82rem',
                    color: 'var(--text)',
                    padding: '4px 2px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={col.required || visibleColumns.includes(col.key)}
                    disabled={col.required}
                    onChange={(e) => {
                      if (!e.target.checked && activeColumns.length <= 1) return;
                      const next = e.target.checked ? [...visibleColumns, col.key] : visibleColumns.filter(key => key !== col.key);
                      setVisibleColumns(next);
                      if (columnPreferenceKey) {
                        try { localStorage.setItem(columnPreferenceKey, JSON.stringify(next)); } catch { /* Optional preference. */ }
                      }
                    }}
                  />
                  <span>{col.header}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Floating Bulk Action Bar */}
      <AnimatePresence>
        {selectedIds && selectedIds.length > 0 && renderBulkActions && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{
              background: 'color-mix(in srgb, var(--primary) 10%, var(--surface))',
              border: '1px solid var(--primary)',
              borderRadius: '8px',
              padding: '0.55rem 1rem',
              marginBottom: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
            }}
          >
            <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text)' }}>
              {selectedIds.length} item{selectedIds.length > 1 ? 's' : ''} selected
            </div>
            <div>{renderBulkActions(selectedIds)}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table Frame */}
      <div
        data-table-scroll
        style={{
          overflow: 'auto',
          maxHeight: '72vh',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          background: 'var(--surface)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr
              style={{
                borderBottom: '1px solid var(--border)',
                background: 'var(--surface-muted)',
              }}
            >
              {onSelectionChange && (
                <th
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 5,
                    background: 'var(--surface-muted)',
                    width: '40px',
                    padding: rowPadding,
                    textAlign: 'center',
                    boxShadow: 'inset 0 -1px 0 var(--border)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isIndeterminate;
                    }}
                    onChange={handleSelectAll}
                    aria-label="Select all rows"
                    style={{ cursor: 'pointer' }}
                  />
                </th>
              )}

              {activeColumns.map((col) => {
                const isSorted = sortState?.field === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={col.className}
                    aria-sort={isSorted && sortState?.direction ? (sortState.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 5,
                      background: 'var(--surface-muted)',
                      padding: rowPadding,
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: isSorted ? 'var(--primary)' : 'var(--muted)',
                      cursor: col.sortable ? 'pointer' : 'default',
                      userSelect: 'none',
                      textAlign: col.align || 'left',
                      width: col.width,
                      boxShadow: 'inset 0 -1px 0 var(--border)',
                    }}
                  >
                    {col.sortable && onSortChange ? (
                      <button type="button" className="inline-flex items-center gap-1.5 text-left" onClick={() => handleHeaderClick(col)}>
                        {col.header}
                        <span aria-hidden="true">{isSorted && sortState?.direction === 'desc' ? '▼' : isSorted ? '▲' : '↕'}</span>
                      </button>
                    ) : <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        justifyContent:
                          col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start',
                      }}
                    >
                      <span>{col.header}</span>
                    </div>}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                  {onSelectionChange && (
                    <td style={{ padding: rowPadding, textAlign: 'center' }}>
                      <Skeleton width="16px" height="16px" />
                    </td>
                  )}
                  {activeColumns.map((col) => (
                    <td key={col.key} className={col.className} style={{ padding: rowPadding }}>
                      <Skeleton height="14px" width="80%" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={activeColumns.length + (onSelectionChange ? 1 : 0)}
                  style={{
                    padding: '2.5rem',
                    textAlign: 'center',
                    color: 'var(--muted)',
                    fontSize: '0.88rem',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      style={{ opacity: 0.5 }}
                    >
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <span>{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const rowKey = keyExtractor(row);
                const isSelected = selectedIds?.includes(rowKey);

                return (
                  <motion.tr
                    key={rowKey}
                    whileHover={{ backgroundColor: 'var(--surface-muted)' }}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      backgroundColor: isSelected ? 'color-mix(in srgb, var(--primary) 8%, var(--surface))' : 'var(--surface)',
                      fontSize,
                      color: 'var(--text)',
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    {onSelectionChange && (
                      <td style={{ padding: rowPadding, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSelectRow(rowKey)}
                          aria-label={`Select row ${rowKey}`}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                    )}

                    {activeColumns.map((col) => (
                      <td
                        key={col.key}
                        className={col.className}
                        style={{
                          padding: rowPadding,
                          textAlign: col.align || 'left',
                          color: 'var(--text)',
                        }}
                      >
                        {col.render ? col.render(row) : (row as any)[col.key]}
                      </td>
                    ))}
                  </motion.tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
