import React, { useState, useEffect, useMemo } from 'react';
import {
  USER_GUIDE_DATA,
  MASTER_WORKFLOWS,
  CATEGORIES_LIST,
} from '../data/userGuideData';
import type { TabGuideItem } from '../data/userGuideData';

interface UserGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTabId: string;
  onNavigateTab: (tabId: string) => void;
  account?: any;
}

type GuideViewMode = 'current' | 'all' | 'workflows';

export const UserGuideModal: React.FC<UserGuideModalProps> = ({
  isOpen,
  onClose,
  activeTabId,
  onNavigateTab,
  account,
}) => {
  const [viewMode, setViewMode] = useState<GuideViewMode>('current');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedTabDetail, setSelectedTabDetail] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>({});

  // When opening or activeTabId changes, focus on current tab
  useEffect(() => {
    if (isOpen) {
      setSelectedTabDetail(activeTabId);
      setViewMode('current');
      setSearchQuery('');
    }
  }, [isOpen, activeTabId]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Current tab guide data fallback
  const currentTabGuide: TabGuideItem = useMemo(() => {
    const targetId = selectedTabDetail || activeTabId;
    return (
      USER_GUIDE_DATA[targetId] || {
        id: targetId,
        title: targetId.charAt(0).toUpperCase() + targetId.slice(1).replace('-', ' '),
        category: 'Platform Feature',
        icon: '▦',
        badge: 'GRC Module',
        summary: `Operational workspace for ${targetId}. Use the navigation tools and actions to manage your compliance records.`,
        roles: ['All Authorized Users'],
        capabilities: ['VIEW_RECORDS'],
        keyActions: ['View records and metrics', 'Filter and search items', 'Export table reports'],
        howToUse: [
          {
            step: 1,
            title: 'Explore Workspace',
            instruction: 'Inspect the records, tables, and metrics on this screen.',
            tip: 'Use the top filters to narrow down by branch or date range.'
          },
          {
            step: 2,
            title: 'Execute Available Actions',
            instruction: 'Use the action buttons in the top right or table rows to create, edit, or approve records.',
            tip: 'All actions are recorded in the audit log.'
          }
        ],
        proTips: ['Refer to the Master Workflows tab for end-to-end guidance across interconnected modules.'],
        relatedTabs: [
          { id: 'dashboard', title: 'Dashboard' },
          { id: 'library', title: 'Document Library' }
        ]
      }
    );
  }, [selectedTabDetail, activeTabId]);

  // Filter all platform features
  const filteredFeatures = useMemo(() => {
    return Object.values(USER_GUIDE_DATA).filter((item) => {
      const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.badge.toLowerCase().includes(q) ||
        item.keyActions.some((a) => a.toLowerCase().includes(q)) ||
        item.howToUse.some((h) => h.title.toLowerCase().includes(q) || h.instruction.toLowerCase().includes(q));

      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  // Filter workflows
  const filteredWorkflows = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return MASTER_WORKFLOWS;
    return MASTER_WORKFLOWS.filter(
      (wf) =>
        wf.title.toLowerCase().includes(q) ||
        wf.summary.toLowerCase().includes(q) ||
        wf.steps.some((s) => s.action.toLowerCase().includes(q) || s.details.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  const toggleStep = (stepKey: string) => {
    setCompletedSteps((prev) => ({ ...prev, [stepKey]: !prev[stepKey] }));
  };

  const handleSelectFeature = (tabId: string) => {
    setSelectedTabDetail(tabId);
    setViewMode('current');
  };

  const handleJumpToTab = (tabId: string) => {
    onNavigateTab(tabId);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop show" style={{ zIndex: 1100 }} onClick={onClose}>
      <div
        className="modal user-guide-modal"
        style={{
          width: 'min(1080px, 96vw)',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          background: 'var(--surface)',
          borderRadius: 14,
          boxShadow: '0 20px 48px rgba(11, 21, 36, 0.22), 0 4px 12px rgba(11, 21, 36, 0.08)',
          border: '1px solid var(--line)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            background: 'linear-gradient(135deg, #0B1524 0%, #162438 100%)',
            color: '#FFFFFF',
            padding: '20px 26px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: 'var(--brand)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                color: '#fff',
                boxShadow: '0 4px 12px rgba(15, 122, 90, 0.35)',
              }}
            >
              📖
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0, color: '#fff' }}>
                  GRC Wisdom Platform User Guide
                </h2>
                <span
                  style={{
                    background: 'rgba(15, 122, 90, 0.4)',
                    color: '#6EE7B7',
                    border: '1px solid rgba(110, 231, 183, 0.3)',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 12,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  Interactive Knowledge
                </span>
                {account?.role && (
                  <span
                    style={{
                      background: 'rgba(255, 255, 255, 0.15)',
                      color: '#FFFFFF',
                      fontSize: 11,
                      fontWeight: 500,
                      padding: '2px 8px',
                      borderRadius: 12,
                    }}
                  >
                    Role: {account.role}
                  </span>
                )}
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--on-dark-muted)' }}>
                Comprehensive step-by-step guides, standard operating procedures, and feature manuals for all modules.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.18)',
              color: '#FFFFFF',
              width: 34,
              height: 34,
              borderRadius: 8,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              transition: 'all 0.15s ease',
            }}
            title="Close Guide (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Mode Navigation & Search Bar */}
        <div
          style={{
            background: 'var(--surface-sunk)',
            padding: '12px 24px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          {/* Navigation Tabs */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                setViewMode('current');
                setSelectedTabDetail(activeTabId);
              }}
              style={{
                background: viewMode === 'current' ? 'var(--brand)' : 'var(--surface)',
                color: viewMode === 'current' ? '#fff' : 'var(--ink-body)',
                border: '1px solid ' + (viewMode === 'current' ? 'var(--brand)' : 'var(--line)'),
                padding: '7px 14px',
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: viewMode === 'current' ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <span>📌 Current Tab Guide</span>
              <span
                style={{
                  background: viewMode === 'current' ? 'rgba(255, 255, 255, 0.25)' : 'var(--surface-sunk)',
                  color: viewMode === 'current' ? '#fff' : 'var(--ink-muted)',
                  fontSize: 11,
                  padding: '1px 6px',
                  borderRadius: 10,
                }}
              >
                {currentTabGuide.title.slice(0, 18)}
              </span>
            </button>

            <button
              onClick={() => setViewMode('all')}
              style={{
                background: viewMode === 'all' ? 'var(--brand)' : 'var(--surface)',
                color: viewMode === 'all' ? '#fff' : 'var(--ink-body)',
                border: '1px solid ' + (viewMode === 'all' ? 'var(--brand)' : 'var(--line)'),
                padding: '7px 14px',
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>🌐 All Platform Features</span>
              <span
                style={{
                  background: viewMode === 'all' ? 'rgba(255, 255, 255, 0.25)' : 'var(--brand-tint)',
                  color: viewMode === 'all' ? '#fff' : 'var(--brand)',
                  fontSize: 11,
                  padding: '1px 6px',
                  borderRadius: 10,
                  fontWeight: 700,
                }}
              >
                {Object.keys(USER_GUIDE_DATA).length}
              </span>
            </button>

            <button
              onClick={() => setViewMode('workflows')}
              style={{
                background: viewMode === 'workflows' ? 'var(--brand)' : 'var(--surface)',
                color: viewMode === 'workflows' ? '#fff' : 'var(--ink-body)',
                border: '1px solid ' + (viewMode === 'workflows' ? 'var(--brand)' : 'var(--line)'),
                padding: '7px 14px',
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>🚀 Master Workflows & SOPs</span>
              <span
                style={{
                  background: viewMode === 'workflows' ? 'rgba(255, 255, 255, 0.25)' : 'var(--warning-bg)',
                  color: viewMode === 'workflows' ? '#fff' : 'var(--warning)',
                  fontSize: 11,
                  padding: '1px 6px',
                  borderRadius: 10,
                  fontWeight: 700,
                }}
              >
                {MASTER_WORKFLOWS.length}
              </span>
            </button>
          </div>

          {/* Search Input */}
          <div style={{ position: 'relative', minWidth: 260, flex: '1 1 240px', maxWidth: 360 }}>
            <span
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--ink-muted)',
                fontSize: 13,
              }}
            >
              ⌕
            </span>
            <input
              type="text"
              placeholder="Search features, how-to guides, roles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 12px 6px 28px',
                fontSize: 13,
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 6,
                color: 'var(--ink)',
                outline: 'none',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--ink-muted)',
                  fontSize: 12,
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Modal Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', background: 'var(--surface)' }}>
          {/* VIEW 1: CURRENT TAB GUIDE */}
          {viewMode === 'current' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Feature Hero Card */}
              <div
                style={{
                  background: 'var(--surface-sunk)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: '20px 24px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: '1 1 500px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span
                      style={{
                        fontSize: 20,
                        width: 34,
                        height: 34,
                        borderRadius: 8,
                        background: 'var(--brand-tint)',
                        color: 'var(--brand)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                      }}
                    >
                      {currentTabGuide.icon}
                    </span>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>
                        {currentTabGuide.title}
                      </h3>
                      <span style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 500 }}>
                        {currentTabGuide.category}
                      </span>
                    </div>
                    <span
                      style={{
                        background: 'var(--info-bg)',
                        color: 'var(--info)',
                        border: '1px solid var(--info-line)',
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 4,
                        marginLeft: 6,
                      }}
                    >
                      {currentTabGuide.badge}
                    </span>
                  </div>

                  <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--ink-body)', lineHeight: 1.55 }}>
                    {currentTabGuide.summary}
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                  {activeTabId !== currentTabGuide.id && (
                    <button
                      onClick={() => handleJumpToTab(currentTabGuide.id)}
                      style={{
                        background: 'var(--brand)',
                        color: '#fff',
                        border: 'none',
                        padding: '8px 16px',
                        borderRadius: 6,
                        fontWeight: 600,
                        fontSize: 13,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        boxShadow: 'var(--shadow-sm)',
                      }}
                    >
                      <span>Go to {currentTabGuide.title}</span>
                      <span>→</span>
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {currentTabGuide.roles.map((role) => (
                      <span
                        key={role}
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--line)',
                          color: 'var(--ink-muted)',
                          fontSize: 11,
                          padding: '3px 8px',
                          borderRadius: 4,
                          fontWeight: 500,
                        }}
                      >
                        👤 {role}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Main 2-Column Content Layout */}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) minmax(0, 1.2fr)', gap: 20 }}>
                {/* Left Column: Step-by-Step "How to Use" Guide */}
                <div>
                  <h4
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: 'var(--ink)',
                      margin: '0 0 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span>📋 Step-by-Step Instructions</span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--ink-muted)',
                      }}
                    >
                      (Click step to track progress)
                    </span>
                  </h4>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {currentTabGuide.howToUse.map((stepItem) => {
                      const stepKey = `${currentTabGuide.id}-step-${stepItem.step}`;
                      const isDone = completedSteps[stepKey];

                      return (
                        <div
                          key={stepItem.step}
                          onClick={() => toggleStep(stepKey)}
                          style={{
                            background: isDone ? 'var(--success-bg)' : 'var(--surface)',
                            border: `1px solid ${isDone ? 'var(--success-line)' : 'var(--line)'}`,
                            borderRadius: 8,
                            padding: '14px 16px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: '50%',
                                background: isDone ? 'var(--success)' : 'var(--brand)',
                                color: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 12,
                                fontWeight: 700,
                                flexShrink: 0,
                                marginTop: 1,
                              }}
                            >
                              {isDone ? '✓' : stepItem.step}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div
                                style={{
                                  fontSize: 14,
                                  fontWeight: 700,
                                  color: isDone ? 'var(--success)' : 'var(--ink)',
                                  textDecoration: isDone ? 'line-through' : 'none',
                                  marginBottom: 4,
                                }}
                              >
                                {stepItem.title}
                              </div>
                              <p
                                style={{
                                  margin: 0,
                                  fontSize: 13,
                                  color: 'var(--ink-body)',
                                  lineHeight: 1.5,
                                }}
                              >
                                {stepItem.instruction}
                              </p>
                              {stepItem.tip && (
                                <div
                                  style={{
                                    marginTop: 6,
                                    fontSize: 12,
                                    color: 'var(--brand-strong)',
                                    background: 'var(--brand-tint)',
                                    padding: '4px 8px',
                                    borderRadius: 4,
                                    display: 'inline-block',
                                  }}
                                >
                                  💡 <strong>Tip:</strong> {stepItem.tip}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right Column: Key Actions & Pro Tips */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Key Capabilities Box */}
                  <div
                    style={{
                      background: 'var(--surface-sunk)',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      padding: '16px',
                    }}
                  >
                    <h5 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                      ⚡ Key Actions & Capabilities
                    </h5>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink-body)', lineHeight: 1.6 }}>
                      {currentTabGuide.keyActions.map((action, i) => (
                        <li key={i}>{action}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Pro Tips Box */}
                  <div
                    style={{
                      background: 'var(--warning-bg)',
                      border: '1px solid var(--warning-line)',
                      borderRadius: 8,
                      padding: '16px',
                    }}
                  >
                    <h5
                      style={{
                        margin: '0 0 8px',
                        fontSize: 13,
                        fontWeight: 700,
                        color: 'var(--warning)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span>🏆 Compliance & Governance Tips</span>
                    </h5>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#784805', lineHeight: 1.55 }}>
                      {currentTabGuide.proTips.map((tip, i) => (
                        <li key={i}>{tip}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Related Features */}
                  {currentTabGuide.relatedTabs && currentTabGuide.relatedTabs.length > 0 && (
                    <div
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--line)',
                        borderRadius: 8,
                        padding: '14px',
                      }}
                    >
                      <h5 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)' }}>
                        🔗 Interconnected Modules
                      </h5>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {currentTabGuide.relatedTabs.map((rel) => (
                          <button
                            key={rel.id}
                            onClick={() => handleSelectFeature(rel.id)}
                            style={{
                              background: 'var(--surface-sunk)',
                              border: '1px solid var(--line)',
                              color: 'var(--ink-body)',
                              fontSize: 12,
                              padding: '4px 10px',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontWeight: 500,
                            }}
                          >
                            {rel.title} →
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* VIEW 2: ALL PLATFORM FEATURES DIRECTORY */}
          {viewMode === 'all' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Category Filter Pills */}
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                {CATEGORIES_LIST.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    style={{
                      background: selectedCategory === cat ? 'var(--ink)' : 'var(--surface-sunk)',
                      color: selectedCategory === cat ? '#fff' : 'var(--ink-body)',
                      border: '1px solid ' + (selectedCategory === cat ? 'var(--ink)' : 'var(--line)'),
                      padding: '5px 12px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Feature Cards Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                  gap: 14,
                }}
              >
                {filteredFeatures.map((feat) => (
                  <div
                    key={feat.id}
                    onClick={() => handleSelectFeature(feat.id)}
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      padding: '16px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      transition: 'all 0.15s ease',
                      position: 'relative',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--brand)';
                      e.currentTarget.style.boxShadow = 'var(--shadow)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--line)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            style={{
                              fontSize: 16,
                              width: 28,
                              height: 28,
                              borderRadius: 6,
                              background: 'var(--brand-tint)',
                              color: 'var(--brand)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 700,
                            }}
                          >
                            {feat.icon}
                          </span>
                          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                            {feat.title}
                          </h4>
                        </div>
                        <span
                          style={{
                            fontSize: 10.5,
                            background: 'var(--surface-sunk)',
                            color: 'var(--ink-muted)',
                            padding: '2px 6px',
                            borderRadius: 4,
                            border: '1px solid var(--line)',
                          }}
                        >
                          {feat.badge}
                        </span>
                      </div>

                      <p
                        style={{
                          margin: '0 0 12px',
                          fontSize: 12.5,
                          color: 'var(--ink-muted)',
                          lineHeight: 1.45,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {feat.summary}
                      </p>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderTop: '1px solid var(--line-soft)',
                        paddingTop: 10,
                      }}
                    >
                      <span style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 600 }}>
                        {feat.howToUse.length} Steps Guide →
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleJumpToTab(feat.id);
                        }}
                        style={{
                          background: 'var(--surface-sunk)',
                          border: '1px solid var(--line)',
                          color: 'var(--ink-body)',
                          fontSize: 11,
                          padding: '3px 8px',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        Open Tab
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* VIEW 3: MASTER WORKFLOWS & SOPS */}
          {viewMode === 'workflows' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div
                style={{
                  background: 'var(--info-bg)',
                  border: '1px solid var(--info-line)',
                  borderRadius: 8,
                  padding: '12px 18px',
                  fontSize: 13,
                  color: 'var(--info)',
                  lineHeight: 1.5,
                }}
              >
                💡 <strong>Standard Operating Procedures (SOPs):</strong> Multi-step master workflows designed for assurance officers, risk managers, and compliance architects navigating interconnected platform modules.
              </div>

              {filteredWorkflows.map((wf) => (
                <div
                  key={wf.id}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 20 }}>{wf.icon}</span>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
                          {wf.title}
                        </h3>
                        <span
                          style={{
                            background: 'var(--brand-tint)',
                            color: 'var(--brand)',
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 4,
                          }}
                        >
                          ⏱ {wf.estimatedTime}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-body)', lineHeight: 1.5 }}>
                        {wf.summary}
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {wf.targetRoles.map((r) => (
                        <span
                          key={r}
                          style={{
                            fontSize: 11,
                            background: 'var(--surface-sunk)',
                            border: '1px solid var(--line)',
                            padding: '2px 8px',
                            borderRadius: 4,
                            color: 'var(--ink-muted)',
                          }}
                        >
                          👤 {r}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Workflow Steps Sequence */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: 10,
                      background: 'var(--surface-sunk)',
                      padding: '14px',
                      borderRadius: 8,
                      border: '1px solid var(--line)',
                    }}
                  >
                    {wf.steps.map((st, i) => (
                      <div
                        key={i}
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--line)',
                          borderRadius: 6,
                          padding: '12px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: 'var(--brand)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                              marginBottom: 4,
                            }}
                          >
                            {st.phase}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
                            {st.action}
                          </div>
                          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.45 }}>
                            {st.details}
                          </p>
                        </div>

                        <button
                          onClick={() => handleJumpToTab(st.tabId)}
                          style={{
                            background: 'var(--brand-tint)',
                            border: '1px solid var(--brand-line)',
                            color: 'var(--brand-strong)',
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '4px 8px',
                            borderRadius: 4,
                            cursor: 'pointer',
                            textAlign: 'center',
                            marginTop: 6,
                          }}
                        >
                          Open {st.tabTitle} →
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            background: 'var(--surface-sunk)',
            padding: '12px 24px',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 12,
            color: 'var(--ink-muted)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span>
              💡 <strong>Quick Shortcut:</strong> Press <kbd style={{ background: 'var(--surface)', border: '1px solid var(--line)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>Esc</kbd> anytime to dismiss this guide.
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                color: 'var(--ink-body)',
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
            <button
              onClick={() => handleJumpToTab(currentTabGuide.id)}
              style={{
                background: 'var(--brand)',
                color: '#FFFFFF',
                border: 'none',
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Open Current Tab ({currentTabGuide.title})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
