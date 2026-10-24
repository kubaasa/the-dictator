import { useState, useEffect } from 'react';
import log from 'electron-log/renderer';
import { TimecodeDisplay, ViewfinderCorners } from './RecEffects';
import type { WidgetType } from '../../shared/types';

type View = 'home' | 'history' | 'modes' | 'vocabulary' | 'shortcuts' | 'widget';

export type { View };

interface SidebarProps {
  activeView: View;
  onNavigate: (view: View) => void;
  onSetupGuide?: () => void;
}

interface NavItem {
  id: View;
  label: string;
  icon: React.ReactNode;
}

// Duotone icons: an outline plus a faint fill of the same shape, both in currentColor
const ICON = {
  className: 'h-[18px] w-[18px] shrink-0',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};
const FILL = { fill: 'currentColor', stroke: 'none', opacity: 0.22 };

const navItems: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: (
      <svg {...ICON}>
        <path {...FILL} d="M4 11 12 4l8 7v9H4z" />
        <path d="M3 11 12 3l9 8M5 10v10h5v-6h4v6h5V10" />
      </svg>
    ),
  },
  {
    id: 'modes',
    label: 'Processing',
    icon: (
      <svg {...ICON}>
        <circle {...FILL} cx="15" cy="6" r="2.5" />
        <circle {...FILL} cx="8" cy="12" r="2.5" />
        <circle {...FILL} cx="16" cy="18" r="2.5" />
        <path d="M3 6h9M18 6h3M3 12h2M11 12h10M3 18h10M19 18h2" />
        <circle cx="15" cy="6" r="2.5" />
        <circle cx="8" cy="12" r="2.5" />
        <circle cx="16" cy="18" r="2.5" />
      </svg>
    ),
  },
  {
    id: 'vocabulary',
    label: 'Vocabulary',
    icon: (
      <svg {...ICON}>
        <path {...FILL} d="M12 7a4 4 0 0 0-4-3H3v14h6a3 3 0 0 1 3 2zM12 7a4 4 0 0 1 4-3h5v14h-6a3 3 0 0 0-3 2z" />
        <path d="M12 7a4 4 0 0 0-4-3H3v14h6a3 3 0 0 1 3 2m0-13a4 4 0 0 1 4-3h5v14h-6a3 3 0 0 0-3 2m0-13v13" />
      </svg>
    ),
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    icon: (
      <svg {...ICON}>
        <rect {...FILL} x="3" y="6" width="18" height="12" rx="2" />
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
      </svg>
    ),
  },
  {
    id: 'widget',
    label: 'Widget',
    icon: (
      <svg {...ICON}>
        <rect {...FILL} x="3" y="4" width="18" height="5" />
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M6.5 6.5h.01M9.5 6.5h.01" />
      </svg>
    ),
  },
  {
    id: 'history',
    label: 'History',
    icon: (
      <svg {...ICON}>
        <circle {...FILL} cx="12" cy="12" r="9" />
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />
      </svg>
    ),
  },
];

export function Sidebar({ activeView, onNavigate, onSetupGuide }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeWidget, setActiveWidget] = useState<WidgetType>('voicebar');

  useEffect(() => {
    window.dictator.getSettings().then((s) => {
      if (s.widget) setActiveWidget(s.widget.activeWidget);
    }).catch((err) => log.error('Failed to load settings in Sidebar:', err));
    const unsub = window.dictator.onSettingsChange((s) => {
      if (s.widget) setActiveWidget(s.widget.activeWidget);
    });
    return unsub;
  }, []);

  return (
    <aside role="navigation" aria-label="Main navigation" className={`flex flex-col gap-1 border-r border-border/60 py-3 transition-all duration-300 overflow-hidden ${collapsed ? 'w-14' : 'w-1/5'}`}>
      {navItems.map((item) => {
        const isActive = item.id === activeView;
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            title={collapsed ? (item.id === 'widget' ? `Widget: ${activeWidget === 'voicebar' ? 'Mini' : 'Maxi'} active` : item.label) : undefined}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex h-[38px] w-full items-center gap-3 text-[13px] font-medium transition-colors ${
              collapsed ? 'justify-center' : 'px-4'
            } ${isActive ? 'text-text' : 'text-text-muted hover:bg-surface hover:text-text'}`}
          >
            {isActive && (
              <span className={`pointer-events-none absolute inset-y-1 ${collapsed ? 'inset-x-2.5' : 'inset-x-1.5'}`} aria-hidden="true">
                <ViewfinderCorners color="var(--color-accent)" size={10} />
              </span>
            )}
            <span className={isActive ? 'text-accent-strong' : 'text-text-dim'}>{item.icon}</span>
            {!collapsed && (
              <span className="flex flex-1 items-center gap-2 whitespace-nowrap">
                {item.label}
                {item.id === 'widget' && (
                  <span className="ml-auto flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
                    </span>
                    <span className="font-mono text-[10px] font-normal tracking-[0.15em] text-ok-text">
                      {activeWidget === 'voicebar' ? 'Mini' : 'Maxi'}
                    </span>
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}

      <div className="flex-1" />

      <div className="flex items-center justify-center gap-1 px-2 py-2">
        {onSetupGuide && (
          <button
            onClick={onSetupGuide}
            title="Setup Guide"
            aria-label="Setup Guide"
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-surface hover:text-text"
          >
            <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
            </svg>
          </button>
        )}

        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-8 w-8 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-surface hover:text-text"
        >
          <svg
            className={`h-4 w-4 shrink-0 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <div className="px-3 py-1 flex flex-col items-center gap-1">
          <span className="font-mono text-[13px] font-bold tracking-[0.35em] text-accent uppercase whitespace-nowrap">
            The Dictator
          </span>
          <TimecodeDisplay />
        </div>
      )}
    </aside>
  );
}
