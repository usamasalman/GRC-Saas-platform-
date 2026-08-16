import React, { useState, useEffect } from 'react';
import { USER_GUIDE_DATA } from '../data/userGuideData';

interface UserGuideToastProps {
  activeTabId: string;
  onOpenFullGuide: () => void;
}

export const UserGuideToast: React.FC<UserGuideToastProps> = ({
  activeTabId,
  onOpenFullGuide,
}) => {
  const [visible, setVisible] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [autoShow, setAutoShow] = useState<boolean>(() => {
    try {
      return localStorage.getItem('gw_guide_autotoast') !== 'false';
    } catch {
      return true;
    }
  });

  const tabGuide = USER_GUIDE_DATA[activeTabId] || {
    id: activeTabId,
    title: activeTabId.charAt(0).toUpperCase() + activeTabId.slice(1).replace('-', ' '),
    category: 'GRC Module',
    icon: '▦',
    badge: 'Module Guide',
    summary: `Operational workspace for ${activeTabId}. Use actions and tools to manage your records.`,
    howToUse: [
      {
        step: 1,
        title: 'Review Records',
        instruction: 'Inspect tables and metrics on this screen.',
      },
    ],
  };

  // Re-trigger toast notification when tab changes if autoShow is enabled
  useEffect(() => {
    if (autoShow) {
      setVisible(true);
      setIsExpanded(false);
      // Auto-collapse after 7 seconds if not expanded or hovered
      const timer = setTimeout(() => {
        setIsExpanded(false);
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [activeTabId, autoShow]);

  const handleToggleAutoShow = () => {
    const next = !autoShow;
    setAutoShow(next);
    try {
      localStorage.setItem('gw_guide_autotoast', String(next));
    } catch {}
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 990,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        fontFamily: 'inherit',
      }}
    >
      {/* Expanded Context Toast */}
      {visible && (
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--brand-line)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(11, 21, 36, 0.14), 0 2px 6px rgba(11, 21, 36, 0.06)',
            width: isExpanded ? 360 : 320,
            overflow: 'hidden',
            animation: 'slideUpFade 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            transition: 'all 0.2s ease',
          }}
        >
          {/* Toast Header */}
          <div
            style={{
              background: 'linear-gradient(135deg, #0F7A5A 0%, #0A5C43 100%)',
              color: '#FFFFFF',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>💡</span>
              <strong style={{ fontSize: 13, fontWeight: 700 }}>
                {tabGuide.title} Guide
              </strong>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  border: 'none',
                  color: '#fff',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: 11,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
                title={isExpanded ? 'Collapse' : 'Expand Quick Steps'}
              >
                {isExpanded ? '▲ Less' : '▼ Steps'}
              </button>
              <button
                onClick={() => setVisible(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.8)',
                  cursor: 'pointer',
                  fontSize: 14,
                  padding: '2px 4px',
                }}
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Toast Body */}
          <div style={{ padding: '12px 14px' }}>
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: 'var(--ink-body)',
                lineHeight: 1.45,
              }}
            >
              {tabGuide.summary}
            </p>

            {/* Quick Steps List when expanded */}
            {isExpanded && tabGuide.howToUse && (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: '1px solid var(--line)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink)' }}>
                  Quick Step Walkthrough:
                </div>
                {tabGuide.howToUse.map((s) => (
                  <div
                    key={s.step}
                    style={{
                      fontSize: 11.5,
                      color: 'var(--ink-body)',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                      lineHeight: 1.4,
                    }}
                  >
                    <span
                      style={{
                        background: 'var(--brand-tint)',
                        color: 'var(--brand)',
                        borderRadius: '50%',
                        width: 16,
                        height: 16,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      {s.step}
                    </span>
                    <div>
                      <strong>{s.title}:</strong> {s.instruction}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Actions Bar */}
            <div
              style={{
                marginTop: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <button
                onClick={onOpenFullGuide}
                style={{
                  background: 'var(--brand)',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <span>📖 Open Full Guide</span>
                <span>→</span>
              </button>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  color: 'var(--ink-muted)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
                title="Toggle automatic popup on tab switch"
              >
                <input
                  type="checkbox"
                  checked={autoShow}
                  onChange={handleToggleAutoShow}
                  style={{ cursor: 'pointer' }}
                />
                Auto-show
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Floating Trigger Pill */}
      <button
        onClick={() => {
          if (!visible) {
            setVisible(true);
          } else {
            onOpenFullGuide();
          }
        }}
        style={{
          background: 'var(--brand)',
          color: '#FFFFFF',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: 24,
          padding: '8px 16px',
          boxShadow: '0 4px 14px rgba(15, 122, 90, 0.35)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontWeight: 600,
          fontSize: 13,
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.background = 'var(--brand-strong)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.background = 'var(--brand)';
        }}
        title="Open User Guide & Feature Manual"
      >
        <span style={{ fontSize: 15 }}>📖</span>
        <span>User Guide</span>
        <span
          style={{
            background: 'rgba(255, 255, 255, 0.25)',
            fontSize: 11,
            padding: '1px 6px',
            borderRadius: 10,
            fontWeight: 700,
          }}
        >
          {tabGuide.title.slice(0, 14)}
        </span>
      </button>
    </div>
  );
};
