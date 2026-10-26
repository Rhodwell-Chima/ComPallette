import React, { useState } from 'react';
import { ProvisioningRequest } from '../types';

interface ProvisioningModalProps {
  isOpen: boolean;
  pendingNodes: ProvisioningRequest[];
  onClose: () => void;
  onAssign: (chipId: string, deviceId: string, role: string, zoneId: string, officerName: string) => Promise<void>;
}

export const ProvisioningModal: React.FC<ProvisioningModalProps> = ({
  isOpen,
  pendingNodes,
  onClose,
  onAssign,
}) => {
  const [selectedChipId, setSelectedChipId] = useState<string>(() => pendingNodes[0]?.chip_id || '');
  const [deviceId, setDeviceId] = useState('');
  const [role, setRole] = useState<'WEARABLE' | 'ANCHOR' | 'GATEWAY'>('WEARABLE');
  const [zoneId, setZoneId] = useState('LEVEL-3-ACTIVE-STOPE');
  const [officerName, setOfficerName] = useState(() => localStorage.getItem('officer_name') || 'Safety_Officer');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync selectedChipId when list updates
  React.useEffect(() => {
    if (pendingNodes.length > 0 && !pendingNodes.some(n => n.chip_id === selectedChipId)) {
      setSelectedChipId(pendingNodes[0].chip_id);
    }
  }, [pendingNodes, selectedChipId]);

  if (!isOpen) return null;

  const activeNode = pendingNodes.find(n => n.chip_id === selectedChipId) || pendingNodes[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeNode || !deviceId.trim()) return;

    try {
      setIsSubmitting(true);
      localStorage.setItem('officer_name', officerName);
      await onAssign(activeNode.chip_id, deviceId.trim(), role, zoneId, officerName);
      setDeviceId('');
      onClose();
    } catch (err) {
      console.error('Error assigning node:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const quickFillBadge = (badge: string) => {
    setDeviceId(badge);
    setRole('WEARABLE');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '540px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="status-dot" style={{ background: 'var(--brand-light)' }} />
              <h3>Dynamic Node Commissioning (OTA)</h3>
            </div>
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: '2px 8px', fontSize: '16px' }}>
              &times;
            </button>
          </div>
        </div>

        <div className="modal-body">
          {pendingNodes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-3)' }}>
              <p style={{ fontSize: '14px', marginBottom: '6px' }}>No uncommissioned nodes detected.</p>
              <p style={{ fontSize: '11px' }}>
                Turn on an unprovisioned ESP32 tag or hold its SOS button for 6 seconds to trigger dynamic enrollment.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Node Selector Pills */}
              <div>
                <label className="form-label">Detected Unassigned Hardware ({pendingNodes.length})</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {pendingNodes.map(node => (
                    <button
                      key={node.chip_id}
                      type="button"
                      className={`btn btn-sm ${selectedChipId === node.chip_id ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setSelectedChipId(node.chip_id)}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      Chip #{node.chip_id}
                    </button>
                  ))}
                </div>
              </div>

              {/* Hardware Diagnostics Card */}
              {activeNode && (
                <div style={{
                  background: 'var(--bg-0)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  padding: '10px 12px',
                  fontSize: '11px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-3)' }}>Hardware MAC:</span>
                    <span className="mono" style={{ color: 'var(--text-1)' }}>{activeNode.chip_mac || 'Unknown'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-3)' }}>Battery &amp; Firmware:</span>
                    <span className="mono" style={{ color: 'var(--brand-text)' }}>
                      {activeNode.battery_v.toFixed(2)}V &bull; v{activeNode.fw_version}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-3)' }}>Detected Sensors:</span>
                    <span>
                      <span className={activeNode.mq_healthy ? 'text-safe' : 'text-dim'}>MQ-7 Gas</span> &bull;{' '}
                      <span className={activeNode.mpu_healthy ? 'text-safe' : 'text-dim'}>MPU6050 IMU</span>
                    </span>
                  </div>
                </div>
              )}

              {/* Assignment Form Fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="form-label">Device / Badge ID</label>
                  <input
                    type="text"
                    className="form-input"
                    value={deviceId}
                    onChange={e => setDeviceId(e.target.value)}
                    placeholder="e.g. MINER-106"
                    required
                    autoFocus
                  />
                  {/* Quick Fill suggestions */}
                  <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                    {['MINER-101', 'MINER-106', 'MINER-112'].map(badge => (
                      <button
                        key={badge}
                        type="button"
                        onClick={() => quickFillBadge(badge)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--brand-light)',
                          fontSize: '10px',
                          cursor: 'pointer',
                          padding: 0,
                          textDecoration: 'underline',
                        }}
                      >
                        {badge}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="form-label">Role</label>
                  <select
                    className="form-input"
                    value={role}
                    onChange={e => setRole(e.target.value as any)}
                  >
                    <option value="WEARABLE">Wearable Miner Tag</option>
                    <option value="ANCHOR">Stationary Tunnel Anchor</option>
                    <option value="GATEWAY">Shaft / Surface Gateway</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="form-label">Underground Zone Assignment</label>
                <select
                  className="form-input"
                  value={zoneId}
                  onChange={e => setZoneId(e.target.value)}
                >
                  <option value="SURFACE-PORTAL">Surface Portal (0m)</option>
                  <option value="LEVEL-1-STATION">Level 1 Station (-100m)</option>
                  <option value="LEVEL-2-NORTH-DRIFT">Level 2 North Drift (-250m)</option>
                  <option value="LEVEL-2-HAULAGE-WAY">Level 2 Haulage Way (-250m)</option>
                  <option value="LEVEL-3-ACTIVE-STOPE">Level 3 Active Stope (-450m)</option>
                </select>
              </div>

              <div>
                <label className="form-label">Commissioning Safety Officer</label>
                <input
                  type="text"
                  className="form-input"
                  value={officerName}
                  onChange={e => setOfficerName(e.target.value)}
                  placeholder="e.g. Moses Banda"
                  required
                />
              </div>

              <div className="modal-footer" style={{ padding: '10px 0 0 0', marginTop: '10px' }}>
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmitting || !deviceId.trim()}
                >
                  {isSubmitting ? 'Dispatching Downlink...' : 'Commission Over-The-Air →'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
