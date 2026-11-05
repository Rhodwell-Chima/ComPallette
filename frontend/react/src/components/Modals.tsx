import React, { useState } from 'react';

interface AckModalProps {
  isOpen: boolean;
  alertId: number | null;
  onClose: () => void;
  onSubmit: (alertId: number, officerName: string) => Promise<void>;
}

export const AckModal: React.FC<AckModalProps> = ({ isOpen, alertId, onClose, onSubmit }) => {
  const [officerName, setOfficerName] = useState(() => localStorage.getItem('officer_name') || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  if (!isOpen || alertId === null) return null;

  const handleSubmit = async () => {
    const name = officerName.trim() || 'Safety_Officer';
    try {
      setIsSubmitting(true);
      setSubmitError('');
      localStorage.setItem('officer_name', name);
      await onSubmit(alertId, name);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The alert could not be acknowledged.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Acknowledge Alert #{alertId}</h3>
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: '2px 8px', fontSize: '16px' }}>
              &times;
            </button>
          </div>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: '13px', color: 'var(--text-2)' }}>
            Acknowledging marks this incident as under active review by safety dispatch.
          </p>
          <div>
            <label className="form-label">Safety Officer Name</label>
            <input
              type="text"
              className="form-input"
              value={officerName}
              onChange={e => setOfficerName(e.target.value)}
              placeholder="e.g. Moses Banda"
              autoFocus
            />
          </div>
          {submitError && <p role="alert" className="form-error">{submitError}</p>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Acknowledging…' : 'Confirm Acknowledgment'}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ResolveModalProps {
  isOpen: boolean;
  alertId: number | null;
  onClose: () => void;
  onSubmit: (alertId: number, officerName: string, notes: string) => Promise<void>;
}

export const ResolveModal: React.FC<ResolveModalProps> = ({ isOpen, alertId, onClose, onSubmit }) => {
  const [officerName, setOfficerName] = useState(() => localStorage.getItem('officer_name') || '');
  const [notes, setNotes] = useState('Ventilation restored; personnel safe and accounted for.');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  if (!isOpen || alertId === null) return null;

  const handleSubmit = async () => {
    const name = officerName.trim() || 'Safety_Officer';
    try {
      setIsSubmitting(true);
      setSubmitError('');
      localStorage.setItem('officer_name', name);
      await onSubmit(alertId, name, notes.trim());
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The alert could not be resolved.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Resolve Alert #{alertId}</h3>
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: '2px 8px', fontSize: '16px' }}>
              &times;
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div>
            <label className="form-label">Resolving Officer Name</label>
            <input
              type="text"
              className="form-input"
              value={officerName}
              onChange={e => setOfficerName(e.target.value)}
              placeholder="e.g. Moses Banda"
              autoFocus
            />
          </div>
          {submitError && <p role="alert" className="form-error">{submitError}</p>}
          <div>
            <label className="form-label">Resolution Notes &amp; Actions Taken</label>
            <textarea
              className="form-textarea"
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Describe corrective actions..."
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Resolving…' : 'Resolve Incident'}
          </button>
        </div>
      </div>
    </div>
  );
};
