/**
 * About Modal - AgenticWork Platform
 * All custom code, all custom SVGs, no dependencies on icon libraries
 */
/* eslint-disable no-restricted-syntax -- About modal uses intentional branded color scheme for sections and diagrams */

import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/contexts/ThemeContext';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Custom SVG Icons - no lucide dependency
const Icons = {
  close: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  ),
  external: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
    </svg>
  ),
  platform: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  ),
  architecture: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 5h16M4 5v14M4 5l8 4M20 5v14M20 5l-8 4M4 19h16M12 9v10" />
      <circle cx="12" cy="9" r="2" />
    </svg>
  ),
  brain: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 4c-2.5 0-4.5 1.5-5.5 3.5C5 8 4 9.5 4 11.5c0 2.5 1.5 4.5 3.5 5.5.5 2 2 3 4.5 3s4-1 4.5-3c2-1 3.5-3 3.5-5.5 0-2-1-3.5-2.5-4C16.5 5.5 14.5 4 12 4z" />
      <path d="M12 4v3M8 10h2M14 10h2M9 14c.5.5 1.5 1 3 1s2.5-.5 3-1" />
    </svg>
  ),
  network: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M12 7v5M7 17l4-5M17 17l-4-5" />
    </svg>
  ),
  briefcase: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M12 12v4" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 3l8 4v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V7l8-4z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c-2.5 3-4 6-4 9s1.5 6 4 9c2.5-3 4-6 4-9s-1.5-6-4-9z" />
    </svg>
  ),
  bolt: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2L4 14h7v8l9-12h-7V2z" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M5 12l5 5L20 7" />
    </svg>
  ),
  server: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="18" height="6" rx="1" />
      <rect x="3" y="14" width="18" height="6" rx="1" />
      <circle cx="7" cy="7" r="1" fill="currentColor" />
      <circle cx="7" cy="17" r="1" fill="currentColor" />
    </svg>
  ),
  database: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
      <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
    </svg>
  ),
  cloud: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M18.5 19h-13A4.5 4.5 0 015 10.5a5.5 5.5 0 0110.78-1.28A3.5 3.5 0 0118.5 19z" />
    </svg>
  ),
  code: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3v18h18" />
      <path d="M7 16l4-4 4 4 5-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  workflow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="3" width="6" height="6" rx="1" />
      <rect x="9" y="15" width="6" height="6" rx="1" />
      <path d="M9 6h6M6 9v3l6 3M18 9v3l-6 3" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="10" r="7" />
      <path d="M15 15l6 6" strokeLinecap="round" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 118 0v4" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
    </svg>
  ),
};

// Section definitions
const sections = [
  { id: 'overview', title: 'What We Built', icon: 'platform', color: '#8b5cf6' },
  { id: 'architecture', title: 'How It Works', icon: 'architecture', color: '#3b82f6' },
  { id: 'deep-research', title: 'Deep Research', icon: 'brain', color: '#ec4899' },
  { id: 'mcp', title: 'Tool Integration', icon: 'network', color: '#06b6d4' },
  { id: 'use-cases', title: 'What You Can Do', icon: 'briefcase', color: '#f59e0b' },
  { id: 'security', title: 'Security', icon: 'shield', color: '#10b981' },
];

const useCaseCategories = [
  {
    id: 'research',
    title: 'Research & Analysis',
    icon: 'search',
    count: 10,
    examples: ['Market research across hundreds of sources', 'Competitive intelligence gathering', 'Technical documentation deep-dives', 'Patent landscape analysis'],
  },
  {
    id: 'workflow',
    title: 'Workflow Automation',
    icon: 'workflow',
    count: 11,
    examples: ['Bulk document processing', 'Automated data pipelines', 'Report generation from raw data', 'Email triage and response drafting'],
  },
  {
    id: 'analytics',
    title: 'Business Intelligence',
    icon: 'chart',
    count: 10,
    examples: ['Real-time operational dashboards', 'Predictive maintenance alerts', 'Usage pattern detection', 'Infrastructure health monitoring'],
  },
  {
    id: 'development',
    title: 'Code & Development',
    icon: 'code',
    count: 8,
    examples: ['Code generation and review', 'Automated refactoring', 'Test generation', 'Documentation from code'],
  },
  {
    id: 'security',
    title: 'Security Operations',
    icon: 'lock',
    count: 6,
    examples: ['Access control management', 'Audit log analysis', 'Compliance report generation', 'Threat detection assistance'],
  },
  {
    id: 'governance',
    title: 'Platform Management',
    icon: 'settings',
    count: 6,
    examples: ['User provisioning', 'Usage tracking and billing', 'Cost optimization', 'Policy configuration'],
  },
];

const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const [activeSection, setActiveSection] = useState('overview');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['research']));
  const contentRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  const toggleCategory = (id: string) => {
    const next = new Set(expandedCategories);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedCategories(next);
  };

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const getIcon = (name: string, size = 18) => {
    const icon = Icons[name as keyof typeof Icons];
    return icon ? <span style={{ width: size, height: size, display: 'block' }}>{icon}</span> : null;
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10001] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(8px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            className="relative w-full max-w-5xl h-[85vh] rounded-2xl overflow-hidden flex"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 25px 80px -15px rgba(0, 0, 0, 0.4)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Gradient top bar */}
            <div
              className="absolute top-0 left-0 right-0 h-1"
              style={{
                background: 'linear-gradient(90deg, #0A84FF, #30D158, #64D2FF, #FF9F0A, #FF453A, #BF5AF2)',
              }}
            />

            {/* Sidebar */}
            <aside
              className="w-56 flex-shrink-0 flex flex-col border-r"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)' }}
            >
              {/* Brand */}
              <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
                    style={{ background: 'linear-gradient(135deg, #0A84FF, #5AC8FA)' }}
                  >
                    {getIcon('bolt', 18)}
                  </div>
                  <div>
                    <h2 className="font-bold" style={{ color: 'var(--color-text)' }}>AgenticWork</h2>
                    <p className="text-xs" style={{ color: 'var(--color-textMuted)' }}>Enterprise AI</p>
                  </div>
                </div>
              </div>

              {/* Nav */}
              <nav className="flex-1 p-2 overflow-y-auto">
                {sections.map((s) => {
                  const active = activeSection === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => scrollToSection(s.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-all mb-0.5"
                      style={{
                        backgroundColor: active ? `${s.color}15` : 'transparent',
                        color: active ? s.color : 'var(--color-textSecondary)',
                        borderLeft: active ? `3px solid ${s.color}` : '3px solid transparent',
                      }}
                    >
                      <span style={{ color: active ? s.color : 'var(--color-textMuted)' }}>
                        {getIcon(s.icon, 16)}
                      </span>
                      {s.title}
                    </button>
                  );
                })}
              </nav>

              {/* Footer link */}
              <div className="p-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
                <a
                  href="https://agenticwork.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--color-textMuted)' }}
                >
                  <span className="w-3.5 h-3.5">{Icons.globe}</span>
                  agenticwork.io
                  <span className="w-3 h-3">{Icons.external}</span>
                </a>
              </div>
            </aside>

            {/* Main content */}
            <main className="flex-1 flex flex-col overflow-hidden">
              {/* Header */}
              <header className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <div>
                  <h1 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>About AgenticWork</h1>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-textMuted)' }}>Custom-built AI orchestration for the enterprise</p>
                </div>
                <button onClick={onClose} className="p-2 rounded-lg hover:bg-red-500/20 transition-colors" style={{ color: 'var(--color-textMuted)' }}>
                  <span className="w-5 h-5 block">{Icons.close}</span>
                </button>
              </header>

              {/* Content scroll area */}
              <div ref={contentRef} className="flex-1 overflow-y-auto p-6 space-y-10">

                {/* OVERVIEW */}
                <section id="section-overview">
                  <SectionTitle icon={getIcon('platform')} title="What We Built" color="#8b5cf6" />
                  <div className="mt-4 space-y-4">
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                      AgenticWork started because we needed something that didn't exist: a way to let teams use
                      AI without losing control over security, costs, or which models they're hitting. Not a
                      wrapper around someone else's API—an actual platform we own end-to-end.
                    </p>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                      Every service you see here—the API, the UI, the MCP proxy, the code execution
                      environment—is custom code we wrote. We did fork Flowise for the visual workflow builder,
                      but we've refactored it significantly to integrate with our auth, our data layer, and our
                      model routing.
                    </p>

                    {/* Stats */}
                    <div className="grid grid-cols-4 gap-3 mt-6">
                      <StatBox value="10K+" label="Concurrent Users" color="#8b5cf6" />
                      <StatBox value="40%" label="Avg Cost Reduction" color="#10b981" />
                      <StatBox value="51" label="Use Cases Shipped" color="#f59e0b" />
                      <StatBox value="5+" label="Cloud Providers" color="#3b82f6" />
                    </div>

                    {/* Core capabilities */}
                    <div className="mt-5">
                      <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Core Capabilities</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <CapCard icon={getIcon('cloud')} title="Multi-Cloud" desc="Azure, AWS, GCP, Oracle, IBM—your choice" />
                        <CapCard icon={getIcon('shield')} title="Zero-Trust Security" desc="E2E encryption, RBAC, audit trails" />
                        <CapCard icon={getIcon('server')} title="Any LLM" desc="OpenAI, Anthropic, Google, Ollama, whatever" />
                        <CapCard icon={getIcon('database')} title="Vector Memory" desc="Milvus-backed semantic search at scale" />
                      </div>
                    </div>
                  </div>
                </section>

                {/* ARCHITECTURE */}
                <section id="section-architecture">
                  <SectionTitle icon={getIcon('architecture')} title="How It Works" color="#3b82f6" />
                  <div className="mt-4 space-y-4">
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                      Five layers, clear boundaries. We can swap out any piece without breaking the others.
                      The whole thing runs in Kubernetes with proper health checks, secrets management, and
                      observability.
                    </p>

                    {/* Architecture diagram - custom SVG */}
                    <div className="mt-5 p-4 rounded-xl" style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)' }}>
                      <svg viewBox="0 0 600 280" className="w-full" style={{ maxHeight: 280 }}>
                        {/* Layer backgrounds */}
                        <rect x="20" y="10" width="560" height="44" rx="6" fill="#8b5cf620" stroke="#8b5cf6" strokeWidth="1" />
                        <rect x="20" y="60" width="560" height="44" rx="6" fill="#3b82f620" stroke="#3b82f6" strokeWidth="1" />
                        <rect x="20" y="110" width="560" height="44" rx="6" fill="#06b6d420" stroke="#06b6d4" strokeWidth="1" />
                        <rect x="20" y="160" width="560" height="44" rx="6" fill="#10b98120" stroke="#10b981" strokeWidth="1" />
                        <rect x="20" y="210" width="560" height="44" rx="6" fill="#f59e0b20" stroke="#f59e0b" strokeWidth="1" />

                        {/* Layer labels */}
                        <text x="35" y="36" fill="#8b5cf6" fontSize="11" fontWeight="600">PRESENTATION</text>
                        <text x="35" y="86" fill="#3b82f6" fontSize="11" fontWeight="600">ORCHESTRATION</text>
                        <text x="35" y="136" fill="#06b6d4" fontSize="11" fontWeight="600">INTELLIGENCE</text>
                        <text x="35" y="186" fill="#10b981" fontSize="11" fontWeight="600">DATA</text>
                        <text x="35" y="236" fill="#f59e0b" fontSize="11" fontWeight="600">INFRASTRUCTURE</text>

                        {/* Components - Presentation */}
                        <rect x="150" y="18" width="70" height="28" rx="4" fill="#8b5cf630" />
                        <text x="185" y="36" fill="var(--color-text)" fontSize="10" textAnchor="middle">React UI</text>
                        <rect x="230" y="18" width="85" height="28" rx="4" fill="#8b5cf630" />
                        <text x="272" y="36" fill="var(--color-text)" fontSize="10" textAnchor="middle">Admin Portal</text>
                        <rect x="325" y="18" width="80" height="28" rx="4" fill="#8b5cf630" />
                        <text x="365" y="36" fill="var(--color-text)" fontSize="10" textAnchor="middle">API Gateway</text>
                        <rect x="415" y="18" width="75" height="28" rx="4" fill="#8b5cf630" />
                        <text x="452" y="36" fill="var(--color-text)" fontSize="10" textAnchor="middle">WebSocket</text>

                        {/* Components - Orchestration */}
                        <rect x="150" y="68" width="85" height="28" rx="4" fill="#3b82f630" />
                        <text x="192" y="86" fill="var(--color-text)" fontSize="10" textAnchor="middle">Model Router</text>
                        <rect x="245" y="68" width="75" height="28" rx="4" fill="#3b82f630" />
                        <text x="282" y="86" fill="var(--color-text)" fontSize="10" textAnchor="middle">MCP Proxy</text>
                        <rect x="330" y="68" width="100" height="28" rx="4" fill="#3b82f630" />
                        <text x="380" y="86" fill="var(--color-text)" fontSize="10" textAnchor="middle">Pipeline Engine</text>
                        <rect x="440" y="68" width="80" height="28" rx="4" fill="#3b82f630" />
                        <text x="480" y="86" fill="var(--color-text)" fontSize="10" textAnchor="middle">RAG Service</text>

                        {/* Components - Intelligence */}
                        <rect x="150" y="118" width="95" height="28" rx="4" fill="#06b6d430" />
                        <text x="197" y="136" fill="var(--color-text)" fontSize="10" textAnchor="middle">Deep Research</text>
                        <rect x="255" y="118" width="100" height="28" rx="4" fill="#06b6d430" />
                        <text x="305" y="136" fill="var(--color-text)" fontSize="10" textAnchor="middle">Model Selection</text>
                        <rect x="365" y="118" width="75" height="28" rx="4" fill="#06b6d430" />
                        <text x="402" y="136" fill="var(--color-text)" fontSize="10" textAnchor="middle">Prompting</text>
                        <rect x="450" y="118" width="70" height="28" rx="4" fill="#06b6d430" />
                        <text x="485" y="136" fill="var(--color-text)" fontSize="10" textAnchor="middle">Memory</text>

                        {/* Components - Data */}
                        <rect x="150" y="168" width="80" height="28" rx="4" fill="#10b98130" />
                        <text x="190" y="186" fill="var(--color-text)" fontSize="10" textAnchor="middle">PostgreSQL</text>
                        <rect x="240" y="168" width="65" height="28" rx="4" fill="#10b98130" />
                        <text x="272" y="186" fill="var(--color-text)" fontSize="10" textAnchor="middle">Milvus</text>
                        <rect x="315" y="168" width="55" height="28" rx="4" fill="#10b98130" />
                        <text x="342" y="186" fill="var(--color-text)" fontSize="10" textAnchor="middle">Redis</text>
                        <rect x="380" y="168" width="60" height="28" rx="4" fill="#10b98130" />
                        <text x="410" y="186" fill="var(--color-text)" fontSize="10" textAnchor="middle">MinIO</text>
                        <rect x="450" y="168" width="70" height="28" rx="4" fill="#10b98130" />
                        <text x="485" y="186" fill="var(--color-text)" fontSize="10" textAnchor="middle">Blob Store</text>

                        {/* Components - Infrastructure */}
                        <rect x="150" y="218" width="80" height="28" rx="4" fill="#f59e0b30" />
                        <text x="190" y="236" fill="var(--color-text)" fontSize="10" textAnchor="middle">Kubernetes</text>
                        <rect x="240" y="218" width="60" height="28" rx="4" fill="#f59e0b30" />
                        <text x="270" y="236" fill="var(--color-text)" fontSize="10" textAnchor="middle">Docker</text>
                        <rect x="310" y="218" width="55" height="28" rx="4" fill="#f59e0b30" />
                        <text x="337" y="236" fill="var(--color-text)" fontSize="10" textAnchor="middle">Vault</text>
                        <rect x="375" y="218" width="75" height="28" rx="4" fill="#f59e0b30" />
                        <text x="412" y="236" fill="var(--color-text)" fontSize="10" textAnchor="middle">Prometheus</text>
                        <rect x="460" y="218" width="60" height="28" rx="4" fill="#f59e0b30" />
                        <text x="490" y="236" fill="var(--color-text)" fontSize="10" textAnchor="middle">Grafana</text>
                      </svg>
                    </div>

                    <p className="text-xs mt-3" style={{ color: 'var(--color-textMuted)' }}>
                      All boxes above represent custom services we built and maintain. The only external dependency
                      in the orchestration layer is the underlying LLM providers themselves.
                    </p>
                  </div>
                </section>

                {/* DEEP RESEARCH */}
                <section id="section-deep-research">
                  <SectionTitle icon={getIcon('brain')} title="Deep Research Agent" color="#ec4899" />
                  <div className="mt-4 space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(236, 72, 153, 0.2)', color: '#ec4899' }}>
                        Project GRAEAE
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                      This is probably the most ambitious piece of the platform. When someone asks a complex
                      question—"What's the competitive landscape for enterprise AI platforms in APAC?"—the
                      system doesn't just call one model and hope for the best.
                    </p>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                      It spins up an 8-phase pipeline: plans the research, searches multiple sources, retrieves
                      documents, extracts relevant facts, validates everything against multiple models, synthesizes
                      a coherent answer, formats a report, and caches the results. The whole thing runs autonomously.
                    </p>

                    {/* Pipeline phases */}
                    <div className="mt-5">
                      <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>The Pipeline</h4>
                      <div className="flex flex-wrap gap-2">
                        {['1. Planning', '2. Search', '3. Retrieval', '4. Extraction', '5. Validation', '6. Synthesis', '7. Report', '8. Cache'].map((phase) => (
                          <span
                            key={phase}
                            className="px-3 py-1.5 rounded-full text-xs font-medium"
                            style={{ background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.15), rgba(139, 92, 246, 0.15))', color: 'var(--color-text)', border: '1px solid rgba(236, 72, 153, 0.3)' }}
                          >
                            {phase}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Validation */}
                    <div className="mt-5">
                      <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>4-Layer Fact Validation</h4>
                      <p className="text-sm mb-3" style={{ color: 'var(--color-textSecondary)' }}>
                        We don't trust any single source. Every claim gets checked:
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <ValidationBox title="Source Triangulation" desc="Needs 3+ independent sources to confirm" />
                        <ValidationBox title="Model Consensus" desc="Multiple LLMs must agree on the interpretation" />
                        <ValidationBox title="Statistical Checks" desc="Automated sanity checks on numbers and dates" />
                        <ValidationBox title="Authority Scoring" desc="Sources weighted by credibility and recency" />
                      </div>
                    </div>

                    {/* LLM routing */}
                    <div className="mt-5">
                      <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Model Routing</h4>
                      <p className="text-sm mb-3" style={{ color: 'var(--color-textSecondary)' }}>
                        Different tasks need different models. We route automatically:
                      </p>
                      <div className="space-y-2">
                        <TierRow tier="Heavy Reasoning" model="Claude Sonnet 4" purpose="Complex analysis, synthesis" color="#8b5cf6" />
                        <TierRow tier="Document Work" model="GPT-4o-mini" purpose="Parsing, extraction, summarization" color="#3b82f6" />
                        <TierRow tier="Quick Tasks" model="Claude Haiku" purpose="Formatting, simple validation" color="#06b6d4" />
                        <TierRow tier="Consensus" model="3-Model Ensemble" purpose="Cross-checking critical facts" color="#10b981" />
                        <TierRow tier="Specialized" model="Domain-specific" purpose="Legal, medical, technical" color="#f59e0b" />
                      </div>
                    </div>
                  </div>
                </section>

                {/* MCP */}
                <section id="section-mcp">
                  <SectionTitle icon={getIcon('network')} title="Tool Integration (MCP)" color="#06b6d4" />
                  <div className="mt-4 space-y-4">
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                      MCP—Model Context Protocol—is how the AI talks to the outside world. Need to query a
                      database? Call an API? Read a file? MCP standardizes all of that into a consistent
                      interface the models understand.
                    </p>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                      Our MCP proxy (custom-built) aggregates multiple MCP servers, handles auth, enforces
                      RBAC, and logs everything. Users only see the tools they're allowed to use.
                    </p>

                    <div className="grid grid-cols-3 gap-3 mt-5">
                      <MCPCard icon={getIcon('search')} title="Auto-Discovery" desc="Tools register themselves; the proxy figures out what's available" />
                      <MCPCard icon={getIcon('shield')} title="Per-Tool RBAC" desc="Fine-grained permissions—Bob can query Postgres, Alice can't" />
                      <MCPCard icon={getIcon('code')} title="MCP Workshop" desc="Build and deploy your own MCP servers through the admin UI" />
                    </div>
                  </div>
                </section>

                {/* USE CASES */}
                <section id="section-use-cases">
                  <SectionTitle icon={getIcon('briefcase')} title="What You Can Do With This" color="#f59e0b" />
                  <div className="mt-4">
                    <p className="text-sm leading-relaxed mb-5" style={{ color: 'var(--color-textSecondary)' }}>
                      51 documented use cases across 6 categories. These aren't hypotheticals—they're things
                      teams are actually doing in production.
                    </p>

                    <div className="space-y-2">
                      {useCaseCategories.map((cat) => {
                        const expanded = expandedCategories.has(cat.id);
                        return (
                          <div
                            key={cat.id}
                            className="rounded-xl overflow-hidden"
                            style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)' }}
                          >
                            <button
                              onClick={() => toggleCategory(cat.id)}
                              className="w-full flex items-center justify-between px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <span style={{ color: '#f59e0b' }}>{getIcon(cat.icon, 16)}</span>
                                <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{cat.title}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b' }}>
                                  {cat.count} use cases
                                </span>
                              </div>
                              <span
                                className="w-4 h-4 transition-transform"
                                style={{ color: 'var(--color-textMuted)', transform: expanded ? 'rotate(90deg)' : 'none' }}
                              >
                                {Icons.chevron}
                              </span>
                            </button>
                            <AnimatePresence>
                              {expanded && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden"
                                >
                                  <div className="px-4 pb-4 pt-1 flex flex-wrap gap-2">
                                    {cat.examples.map((ex) => (
                                      <span
                                        key={ex}
                                        className="text-xs px-2.5 py-1 rounded-lg"
                                        style={{ backgroundColor: 'var(--color-surfaceTertiary)', color: 'var(--color-textSecondary)' }}
                                      >
                                        {ex}
                                      </span>
                                    ))}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>

                {/* SECURITY */}
                <section id="section-security">
                  <SectionTitle icon={getIcon('shield')} title="Security" color="#10b981" />
                  <div className="mt-4 space-y-4">
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                      Zero-trust from the ground up. Every request is authenticated, every action is logged,
                      every secret is managed properly. We designed this for environments where security
                      isn't optional.
                    </p>

                    <div className="grid grid-cols-2 gap-3 mt-5">
                      <SecurityItem title="TLS Everywhere" desc="All traffic encrypted, internal and external" />
                      <SecurityItem title="RBAC + Azure AD" desc="Fine-grained permissions synced with your identity provider" />
                      <SecurityItem title="Complete Audit Trail" desc="Every action logged with tamper protection" />
                      <SecurityItem title="Data Residency" desc="Deploy in your region, data stays there" />
                      <SecurityItem title="Vault Integration" desc="Secrets in HashiCorp Vault, not in env vars" />
                      <SecurityItem title="Compliance Ready" desc="SOC2, HIPAA, GDPR frameworks supported" />
                    </div>
                  </div>
                </section>

                {/* Footer */}
                <div className="pt-6 border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                      2025 AgenticWork LLC — All services custom-built except where noted
                    </span>
                    <a
                      href="https://agenticwork.io"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs hover:opacity-70 transition-opacity"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      agenticwork.io
                      <span className="w-3 h-3">{Icons.external}</span>
                    </a>
                  </div>
                </div>
              </div>
            </main>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

// Sub-components

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string; color: string }> = ({ icon, title, color }) => (
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}20`, color }}>
      {icon}
    </div>
    <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{title}</h3>
  </div>
);

const StatBox: React.FC<{ value: string; label: string; color: string }> = ({ value, label, color }) => (
  <div className="p-3 rounded-xl text-center" style={{ backgroundColor: `${color}10`, border: `1px solid ${color}30` }}>
    <div className="text-xl font-bold" style={{ color }}>{value}</div>
    <div className="text-xs mt-0.5" style={{ color: 'var(--color-textMuted)' }}>{label}</div>
  </div>
);

const CapCard: React.FC<{ icon: React.ReactNode; title: string; desc: string }> = ({ icon, title, desc }) => (
  <div className="flex items-start gap-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
    <span style={{ color: 'var(--color-primary)' }} className="flex-shrink-0 mt-0.5">{icon}</span>
    <div>
      <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{title}</div>
      <div className="text-xs mt-0.5" style={{ color: 'var(--color-textMuted)' }}>{desc}</div>
    </div>
  </div>
);

const ValidationBox: React.FC<{ title: string; desc: string }> = ({ title, desc }) => (
  <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
    <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{title}</div>
    <p className="text-xs mt-1" style={{ color: 'var(--color-textMuted)' }}>{desc}</p>
  </div>
);

const TierRow: React.FC<{ tier: string; model: string; purpose: string; color: string }> = ({ tier, model, purpose, color }) => (
  <div className="flex items-center gap-4 px-3 py-2 rounded-lg" style={{ backgroundColor: `${color}10` }}>
    <div className="w-28 text-xs font-semibold" style={{ color }}>{tier}</div>
    <div className="w-28 text-xs font-medium" style={{ color: 'var(--color-text)' }}>{model}</div>
    <div className="flex-1 text-xs" style={{ color: 'var(--color-textMuted)' }}>{purpose}</div>
  </div>
);

const MCPCard: React.FC<{ icon: React.ReactNode; title: string; desc: string }> = ({ icon, title, desc }) => (
  <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid rgba(6, 182, 212, 0.2)' }}>
    <span style={{ color: '#06b6d4' }}>{icon}</span>
    <h4 className="text-sm font-semibold mt-2" style={{ color: 'var(--color-text)' }}>{title}</h4>
    <p className="text-xs mt-1" style={{ color: 'var(--color-textMuted)' }}>{desc}</p>
  </div>
);

const SecurityItem: React.FC<{ title: string; desc: string }> = ({ title, desc }) => (
  <div className="flex items-start gap-2">
    <span className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#10b981' }}>{Icons.check}</span>
    <div>
      <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{title}</div>
      <div className="text-xs" style={{ color: 'var(--color-textMuted)' }}>{desc}</div>
    </div>
  </div>
);

export default AboutModal;
