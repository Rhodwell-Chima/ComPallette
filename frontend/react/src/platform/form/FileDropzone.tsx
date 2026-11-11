import { useState, useRef, DragEvent, ChangeEvent } from 'react';
import { useFormField } from './FormField';

export interface FileDropzoneProps {
  accept?: string;
  maxSizeBytes?: number;
  onFileSelect?: (file: File) => void;
  helperText?: string;
  isUploading?: boolean;
  uploadProgress?: number;
}

export function FileDropzone({
  accept,
  maxSizeBytes = 10 * 1024 * 1024, // 10MB default
  onFileSelect,
  helperText = 'Drag & drop file or browse',
  isUploading = false,
  uploadProgress = 0,
}: FileDropzoneProps) {
  const field = useFormField();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const validateAndHandle = (file: File) => {
    setErrorMessage(null);
    if (maxSizeBytes && file.size > maxSizeBytes) {
      setErrorMessage(`File exceeds max size of ${formatSize(maxSizeBytes)}`);
      return;
    }
    setSelectedFile(file);
    field?.setHasValue(true);
    onFileSelect?.(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndHandle(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndHandle(e.target.files[0]);
    }
  };

  const error = errorMessage || field?.error;

  return (
    <div style={{ width: '100%' }}>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${
            error
              ? 'var(--color-error, #ef4444)'
              : isDragOver
              ? 'var(--color-accent, #3b82f6)'
              : 'var(--color-border, rgba(255, 255, 255, 0.15))'
          }`,
          borderRadius: '8px',
          padding: '1.5rem',
          textAlign: 'center',
          backgroundColor: isDragOver
            ? 'rgba(59, 130, 246, 0.08)'
            : 'var(--color-surface, rgba(15, 23, 42, 0.4))',
          cursor: 'pointer',
          transition: 'all 0.2s cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isDragOver ? 'var(--color-accent, #3b82f6)' : 'var(--color-text-muted, #94a3b8)',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>

          <div>
            <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--color-text, #f8fafc)' }}>
              {selectedFile ? selectedFile.name : helperText}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #94a3b8)', marginTop: '2px' }}>
              {selectedFile
                ? `${formatSize(selectedFile.size)}`
                : `Max size: ${formatSize(maxSizeBytes)} ${accept ? `(${accept})` : ''}`}
            </div>
          </div>
        </div>

        {isUploading && (
          <div style={{ marginTop: '1rem', width: '100%' }}>
            <div
              style={{
                width: '100%',
                height: '4px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '2px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${uploadProgress}%`,
                  height: '100%',
                  backgroundColor: 'var(--color-accent, #3b82f6)',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #94a3b8)', marginTop: '4px' }}>
              Uploading {uploadProgress}%
            </span>
          </div>
        )}
      </div>

      {error && (
        <span
          role="alert"
          style={{
            fontSize: '0.76rem',
            color: 'var(--color-error, #ef4444)',
            marginTop: '0.35rem',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
