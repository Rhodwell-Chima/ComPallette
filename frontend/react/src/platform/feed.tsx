import React, { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  Clock,
  KeyRound,
  Network,
  Radio,
  ShieldAlert,
  User,
  UserCheck,
  Zap,
} from 'lucide-react';
import {
  getPrefersReducedMotion,
  reducedMotionVariants,
  staggerContainerVariants,
  staggerItemDownVariants,
  staggerItemUpVariants,
  staggerItemRightVariants,
  staggerItemScaleVariants,
} from './motion';
import { LoadMoreButton } from './pagination';
import { Skeleton } from './loading';

export interface FeedItemData {
  id: string | number;
  timestamp: number;
  actor?: string;
  action: string;
  details: string;
  category?: 'ALERT' | 'USER' | 'DEVICE' | 'TELEMETRY' | 'GENERAL';
  status?: string;
  badge?: string;
  route?: string;
}

export function formatFeedTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function getDateGroupBucket(timestamp: number): 'Today' | 'Yesterday' | 'Older' {
  const now = new Date();
  const date = new Date(timestamp);

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;

  const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  if (itemDay >= today) return 'Today';
  if (itemDay >= yesterday) return 'Yesterday';
  return 'Older';
}

function getFeedIcon(action: string, category?: string) {
  if (category === 'ALERT' || action.includes('ALERT')) {
    return <ShieldAlert size={15} color="var(--danger, #c42a2a)" />;
  }
  if (category === 'USER' || action.includes('USER') || action.includes('ACCESS') || action.includes('PASSWORD')) {
    return <UserCheck size={15} color="var(--primary, #1666d9)" />;
  }
  if (category === 'DEVICE' || action.includes('PROVISION') || action.includes('NODE')) {
    return <Radio size={15} color="var(--warning, #b96700)" />;
  }
  return <Activity size={15} color="var(--success, #17835d)" />;
}

export interface ActivityFeedProps {
  items: FeedItemData[];
  isLoading?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
  remainingCount?: number;
  emptyMessage?: string;
  className?: string;
  maxItemsToStagger?: number;
}

export function ActivityFeed({
  items,
  isLoading = false,
  onLoadMore,
  hasMore = false,
  remainingCount,
  emptyMessage = 'No activity entries recorded.',
  className = '',
  maxItemsToStagger = 15,
}: ActivityFeedProps) {
  const prefersReduced = getPrefersReducedMotion();

  // Group items by date bucket
  const groups: { bucket: 'Today' | 'Yesterday' | 'Older'; items: FeedItemData[] }[] = [
    { bucket: 'Today', items: [] },
    { bucket: 'Yesterday', items: [] },
    { bucket: 'Older', items: [] },
  ];

  for (const item of items) {
    const bucket = getDateGroupBucket(item.timestamp);
    const group = groups.find((g) => g.bucket === bucket);
    if (group) group.items.push(item);
  }

  const activeGroups = groups.filter((g) => g.items.length > 0);

  if (!items.length && !isLoading) {
    return (
      <div className="empty-state" style={{ padding: '2rem', textAlign: 'center' }}>
        <p className="muted">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`activity-feed-container ${className}`} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <motion.div
        variants={prefersReduced ? reducedMotionVariants : staggerContainerVariants}
        initial="hidden"
        animate="visible"
      >
        {activeGroups.map((group) => (
          <section key={group.bucket} style={{ marginBottom: '12px' }}>
            {/* Sticky Date Group Header */}
            <div
              className="feed-group-header"
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                background: 'color-mix(in srgb, var(--surface) 94%, transparent)',
                backdropFilter: 'blur(8px)',
                borderRadius: '6px',
                marginBottom: '6px',
                border: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
              }}
            >
              <Clock size={13} className="muted" />
              <strong style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text)' }}>
                {group.bucket}
              </strong>
              <span className="muted" style={{ fontSize: '0.7rem' }}>
                ({group.items.length})
              </span>
            </div>

            {/* Grouped Feed Items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {group.items.map((item, index) => {
                const shouldStagger = index < maxItemsToStagger && !prefersReduced;
                return (
                  <motion.article
                    key={item.id}
                    variants={shouldStagger ? staggerItemDownVariants : reducedMotionVariants}
                    className="feed-item"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '32px 1fr auto',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '8px 12px',
                      borderRadius: '7px',
                      border: '1px solid var(--border-subtle, rgba(255,255,255,0.04))',
                      background: 'var(--surface)',
                      transition: 'background 0.15s ease, transform 0.15s ease',
                      cursor: 'default',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--surface-muted)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--surface)';
                    }}
                  >
                    {/* Left Icon / Avatar */}
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--surface-muted)',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {getFeedIcon(item.action, item.category)}
                    </div>

                    {/* Middle: Primary Text, Actor & Details */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <strong style={{ fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.action.replace(/_/g, ' ')}
                        </strong>
                        {item.actor && (
                          <small className="muted" style={{ fontSize: '0.72rem' }}>
                            by @{item.actor}
                          </small>
                        )}
                      </div>
                      <p
                        className="muted"
                        style={{
                          margin: '2px 0 0',
                          fontSize: '0.76rem',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.details}
                      </p>
                    </div>

                    {/* Right Side: Timestamp & Status badge */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                      <time className="muted" style={{ fontSize: '0.72rem' }}>
                        {formatFeedTime(item.timestamp)}
                      </time>
                      {item.badge && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--surface-muted)',
                          }}
                        >
                          {item.badge}
                        </span>
                      )}
                    </div>
                  </motion.article>
                );
              })}
            </div>
          </section>
        ))}
      </motion.div>

      {/* Skeletons on loading */}
      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px' }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '8px' }}>
              <Skeleton variant="circle" width={32} height={32} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <Skeleton variant="text" width="40%" height={14} />
                <Skeleton variant="text" width="70%" height={12} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Load More Button */}
      {hasMore && onLoadMore && (
        <LoadMoreButton
          onClick={onLoadMore}
          isLoading={isLoading}
          remainingCount={remainingCount}
          pageSize={10}
        />
      )}
    </div>
  );
}

/**
 * Universal Stagger Animation Wrapper for grids and card sets
 */
export function StaggerContainer({
  children,
  className = '',
  delay = 0.06,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const prefersReduced = getPrefersReducedMotion();

  const customContainerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: delay,
        delayChildren: 0,
        ease: [0.25, 0.1, 0.25, 1],
      },
    },
  };

  return (
    <motion.div
      className={className}
      variants={prefersReduced ? reducedMotionVariants : customContainerVariants}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className = '',
  variant = 'down',
}: {
  children: ReactNode;
  className?: string;
  variant?: 'down' | 'up' | 'right' | 'scale';
}) {
  const prefersReduced = getPrefersReducedMotion();

  const variantMap = {
    down: staggerItemDownVariants,
    up: staggerItemUpVariants,
    right: staggerItemRightVariants,
    scale: staggerItemScaleVariants,
  };

  return (
    <motion.div
      className={className}
      variants={prefersReduced ? reducedMotionVariants : variantMap[variant]}
    >
      {children}
    </motion.div>
  );
}
