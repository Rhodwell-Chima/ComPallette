import React, { useState } from 'react';

interface AckModalProps {
  isOpen: boolean;
  alertId: number | null;
  onClose: () => void;
  onSubmit: (alertId: number, officerName: string) => Promise<void>;
}

export const AckModal: React.FC<AckModalProps> = ({ isOpen, alertId, onClose, onSubmit }) => {
  const [officerName, setOfficerName] = useState(() => localStorage.getItem('officer_name') || '');

  if (!isOpen || alertId === null) return null;

  const handleSubmit = async () => {
    const name = officerName.trim() || 'Safety_Officer';
    localStorage.setItem('officer_name', name);
    await onSubmit(alertId, name);
    onClose();
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(2px)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '8px',
        width: '90%',
        maxWidth: '480px',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)', fontWeight: 700, fontSize: '14px', display: 'flex', justifyContent: 'space-between' }}>
          <span>Acknowledge Safety Incident #{alertId}</span>
          <button className="btn" onClick={onClose}>&times;</button>
        </div>
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Acknowledging marks this incident as under active triage by safety operations.
          </p>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px' }}>
              Safety Officer Name
            </label>
            <input
              type="text"
              className="form-input"
              value={officerName}
              onChange={e => setOfficerName(e.target.value)}
              placeholder="e.g. Moses Banda"
            />
          </div>
        </div>
        <div style={{ padding: '12px 20px', backgroundColor: 'rgba(0, 0, 0, 0.2)', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-warning" onClick={handleSubmit}>Confirm Acknowledged</button>
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
  const [notes, setNotes] = useState('Ventilation restored; miner inspected and uninjured.');

  if (!isOpen || alertId === null) return null;

  const handleSubmit = async () => {
    const name = officerName.trim() || 'Safety_Officer';
    localStorage.setItem('officer_name', name);
    await onSubmit(alertId, name, notes.trim());
    onClose();
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(2px)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '8px',
        width: '90%',
        maxWidth: '480px',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)', fontWeight: 700, fontSize: '14px', display: 'flex', justifyContent: 'space-between' }}>
          <span>Resolve Safety Incident #{alertId}</span>
          <button className="btn" onClick={onClose}>&times;</button>
        </div>
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px' }}>
              Resolving Officer Name
            </label>
            <input
              type="text"
              className="form-input"
              value={officerName}
              onChange={e => setOfficerName(e.target.value)}
              placeholder="e.g. Moses Banda"
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px' }}>
              Corrective Action &amp; Incident Notes
            </label>
            <textarea
              className="form-textarea"
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Describe corrective actions..."
            />
          </div>
        </div>
        <div style={{ padding: '12px 20px', backgroundColor: 'rgba(0, 0, 0, 0.2)', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-success" onClick={handleSubmit}>Close Incident</button>
        </div>
      </div>
    </div>
  );
};
