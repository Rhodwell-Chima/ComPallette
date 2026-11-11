import { ReactNode } from 'react';

export type SortDirection = 'asc' | 'desc' | null;

export interface ColumnDef<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  sticky?: boolean;
}

export interface SortState {
  field: string;
  direction: SortDirection;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  isLoading?: boolean;
  emptyMessage?: string;
  sortState?: SortState;
  onSortChange?: (sort: SortState) => void;
  selectedIds?: (string | number)[];
  onSelectionChange?: (selectedIds: (string | number)[]) => void;
  renderBulkActions?: (selectedIds: (string | number)[]) => ReactNode;
  renderToolbar?: () => ReactNode;
  density?: 'compact' | 'comfortable';
  onDensityChange?: (density: 'compact' | 'comfortable') => void;
  className?: string;
}
