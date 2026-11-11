import { forwardRef, useState, useEffect } from 'react';
import { Input, InputProps } from './Input';

export interface SearchInputProps extends Omit<InputProps, 'type' | 'leftIcon' | 'rightIcon'> {
  onClear?: () => void;
  debounceMs?: number;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { onClear, debounceMs = 0, onChange, value, defaultValue, placeholder = 'Search...', ...rest },
  ref
) {
  const [innerValue, setInnerValue] = useState<string>(
    value !== undefined ? String(value) : defaultValue !== undefined ? String(defaultValue) : ''
  );

  useEffect(() => {
    if (value !== undefined) {
      setInnerValue(String(value));
    }
  }, [value]);

  const handleClear = () => {
    setInnerValue('');
    onClear?.();
    if (onChange) {
      const event = {
        target: { value: '' },
      } as React.ChangeEvent<HTMLInputElement>;
      onChange(event);
    }
  };

  const searchIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );

  const clearButton = innerValue ? (
    <button
      type="button"
      onClick={handleClear}
      aria-label="Clear search"
      style={{
        background: 'none',
        border: 'none',
        padding: '2px',
        color: 'var(--color-text-muted, #94a3b8)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  ) : undefined;

  return (
    <Input
      ref={ref}
      type="text"
      placeholder={placeholder}
      leftIcon={searchIcon}
      rightIcon={clearButton}
      value={innerValue}
      onChange={(e) => {
        setInnerValue(e.target.value);
        onChange?.(e);
      }}
      {...rest}
    />
  );
});
