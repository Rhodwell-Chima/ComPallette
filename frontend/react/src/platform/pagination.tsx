import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

/**
 * Generates an array of page numbers and ellipses for clean pagination display.
 * e.g., [1, 2, 3, '...', 10] or [1, '...', 4, 5, 6, '...', 10]
 */
export function generatePaginationRange(
  currentPage: number,
  totalPages: number,
  siblingCount: number = 1
): (number | '...')[] {
  if (totalPages <= 1) return [1];

  const totalPageNumbers = siblingCount * 2 + 5; // siblingCount on each side + 1 + 2 (first/last) + 2 (ellipses)

  if (totalPageNumbers >= totalPages) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const leftSiblingIndex = Math.max(currentPage - siblingCount, 1);
  const rightSiblingIndex = Math.min(currentPage + siblingCount, totalPages);

  const shouldShowLeftDots = leftSiblingIndex > 2;
  const shouldShowRightDots = rightSiblingIndex < totalPages - 2;

  const firstPageIndex = 1;
  const lastPageIndex = totalPages;

  if (!shouldShowLeftDots && shouldShowRightDots) {
    const leftItemCount = 3 + 2 * siblingCount;
    const leftRange = Array.from({ length: leftItemCount }, (_, i) => i + 1);
    return [...leftRange, '...', totalPages];
  }

  if (shouldShowLeftDots && !shouldShowRightDots) {
    const rightItemCount = 3 + 2 * siblingCount;
    const rightRange = Array.from(
      { length: rightItemCount },
      (_, i) => totalPages - rightItemCount + i + 1
    );
    return [firstPageIndex, '...', ...rightRange];
  }

  if (shouldShowLeftDots && shouldShowRightDots) {
    const middleRange = Array.from(
      { length: rightSiblingIndex - leftSiblingIndex + 1 },
      (_, i) => leftSiblingIndex + i
    );
    return [firstPageIndex, '...', ...middleRange, '...', lastPageIndex];
  }

  return Array.from({ length: totalPages }, (_, i) => i + 1);
}

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems?: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  variant?: 'full' | 'compact';
  enableKeyboardNavigation?: boolean;
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize = 25,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  variant = 'full',
  enableKeyboardNavigation = true,
  className = '',
}: PaginationProps) {
  const safeTotalPages = Math.max(1, totalPages);
  const safeCurrentPage = Math.min(Math.max(1, currentPage), safeTotalPages);

  // Keyboard navigation: Left/Right arrows when focused
  useEffect(() => {
    if (!enableKeyboardNavigation) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid intercepting when user is inside an input or textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'ArrowLeft' && safeCurrentPage > 1) {
        onPageChange(safeCurrentPage - 1);
      } else if (e.key === 'ArrowRight' && safeCurrentPage < safeTotalPages) {
        onPageChange(safeCurrentPage + 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableKeyboardNavigation, safeCurrentPage, safeTotalPages, onPageChange]);

  const startItem = totalItems ? Math.min((safeCurrentPage - 1) * pageSize + 1, totalItems) : 1;
  const endItem = totalItems ? Math.min(safeCurrentPage * pageSize, totalItems) : pageSize;

  if (variant === 'compact') {
    return (
      <div className={`pagination-container compact ${className}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.875rem' }}>
        <span className="muted">
          Page <strong>{safeCurrentPage}</strong> of <strong>{safeTotalPages}</strong>
        </span>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <button
            type="button"
            className="button ghost icon-only"
            disabled={safeCurrentPage <= 1}
            onClick={() => onPageChange(safeCurrentPage - 1)}
            aria-label="Previous page"
            style={{ padding: '0.4rem' }}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="button ghost icon-only"
            disabled={safeCurrentPage >= safeTotalPages}
            onClick={() => onPageChange(safeCurrentPage + 1)}
            aria-label="Next page"
            style={{ padding: '0.4rem' }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  const paginationRange = generatePaginationRange(safeCurrentPage, safeTotalPages);

  return (
    <nav className={`pagination-container full ${className}`} aria-label="Pagination Navigation" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginTop: '1.25rem' }}>
      <div className="pagination-info" style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.85rem' }}>
        {onPageSizeChange && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="muted">Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="pagination-pagesize-select"
              aria-label="Items per page"
              style={{
                padding: '0.25rem 0.5rem',
                borderRadius: '6px',
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                fontSize: '0.82rem',
              }}
            >

              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
        {totalItems !== undefined && (
          <span className="muted">
            Showing <strong>{startItem}</strong>–<strong>{endItem}</strong> of <strong>{totalItems}</strong> results
          </span>
        )}
      </div>

      <div className="pagination-controls" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        <button
          type="button"
          className="button ghost"
          disabled={safeCurrentPage <= 1}
          onClick={() => onPageChange(safeCurrentPage - 1)}
          aria-label="Go to previous page"
          style={{ padding: '0.35rem 0.65rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
        >
          <ChevronLeft size={16} />
          <span>Prev</span>
        </button>

        <div className="pagination-numbers" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          {paginationRange.map((pageNumber, idx) => {
            if (pageNumber === '...') {
              return (
                <span key={`dots-${idx}`} className="pagination-ellipsis" style={{ padding: '0.35rem 0.5rem', color: 'var(--text-muted, #8b949e)' }}>
                  &#8230;
                </span>
              );
            }

            const isCurrent = pageNumber === safeCurrentPage;
            return (
              <button
                key={pageNumber}
                type="button"
                className={`button ${isCurrent ? 'primary' : 'ghost'}`}
                aria-current={isCurrent ? 'page' : undefined}
                onClick={() => onPageChange(pageNumber as number)}
                style={{
                  minWidth: '32px',
                  height: '32px',
                  padding: '0 0.5rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px',
                  fontWeight: isCurrent ? 600 : 400,
                }}
              >
                {pageNumber}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="button ghost"
          disabled={safeCurrentPage >= safeTotalPages}
          onClick={() => onPageChange(safeCurrentPage + 1)}
          aria-label="Go to next page"
          style={{ padding: '0.35rem 0.65rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
        >
          <span>Next</span>
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  );
}

/**
 * Alternative "Load More" variant for infinite / stream lists
 */
export function LoadMoreButton({
  onClick,
  isLoading = false,
  remainingCount,
  pageSize = 25,
  className = '',
}: {
  onClick: () => void;
  isLoading?: boolean;
  remainingCount?: number;
  pageSize?: number;
  className?: string;
}) {
  const countToLoad = remainingCount !== undefined ? Math.min(remainingCount, pageSize) : pageSize;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '1.5rem 0' }} className={className}>
      <button
        type="button"
        className="button secondary"
        disabled={isLoading}
        onClick={onClick}
        style={{ minWidth: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
      >
        {isLoading ? (
          <span>Loading more...</span>
        ) : (
          <span>
            Load {countToLoad} more {remainingCount !== undefined ? `(${remainingCount} remaining)` : ''}
          </span>
        )}
      </button>
    </div>
  );
}
