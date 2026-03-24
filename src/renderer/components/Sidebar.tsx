import { useState, useEffect } from 'react';
import log from 'electron-log/renderer';
import { TimecodeDisplay } from './RecEffects';
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

const navItems: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    id: 'modes',
    label: 'Processing',
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
      </svg>
    ),
  },
  {
    id: 'vocabulary',
    label: 'Vocabulary',
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h12A2.25 2.25 0 0 1 20.25 6v12A2.25 2.25 0 0 1 18 20.25H6A2.25 2.25 0 0 1 3.75 18V6Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 15h1.5m3 0h4.5M7.5 9l2.25 2.25L7.5 13.5m4.5-1.5h4.5" />
      </svg>
    ),
  },
  {
    id: 'widget',
    label: 'Widget',
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.25V6a2.25 2.25 0 0 1 2.25-2.25h1.5M3 15.75V18a2.25 2.25 0 0 0 2.25 2.25h1.5M15.75 3.75h1.5A2.25 2.25 0 0 1 19.5 6v2.25M15.75 20.25h1.5A2.25 2.25 0 0 0 19.5 18v-2.25" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 8.25h6v6h-6v-6Z" />
      </svg>
    ),
  },
  {
    id: 'history',
    label: 'History',
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
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
    <aside role="navigation" aria-label="Main navigation" className={`flex flex-col gap-1 border-r border-neutral-800/50 py-3 transition-all duration-300 overflow-hidden ${collapsed ? 'w-14' : 'w-1/5'}`}>
      {navItems.map((item) => {
        const isActive = item.id === activeView;
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            title={collapsed ? (item.id === 'widget' ? `Widget — ${activeWidget === 'voicebar' ? 'Mini' : 'Maxi'} active` : item.label) : undefined}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            className={`flex flex-row items-center gap-3 px-3 py-2 w-full transition-colors ${
              isActive
                ? 'border-l-2 border-red-600 bg-red-600/5 text-neutral-100'
                : 'border-l-2 border-transparent text-neutral-600 hover:text-neutral-300'
            }`}
          >
            <span className={isActive ? 'text-red-500' : 'text-neutral-600'}>{item.icon}</span>
            {!collapsed && (
              <span className="flex items-center gap-2 font-mono text-[13px] font-semibold tracking-[0.25em] uppercase whitespace-nowrap">
                {item.label}
                {item.id === 'widget' && (
                  <span className="flex items-center gap-1.5 ml-auto">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                    </span>
                    <span className="font-mono text-[10px] font-normal tracking-[0.15em] text-green-500/70">
                      {activeWidget === 'voicebar' ? 'Mini' : 'Maxi'}
                    </span>
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom actions — icon-only with tooltip */}
      <div className="flex items-center justify-center gap-1 px-2 py-2">
        {/* Setup Guide */}
        {onSetupGuide && (
          <button
            onClick={onSetupGuide}
            title="Setup Guide"
            aria-label="Setup Guide"
            className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
          >
            <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
            </svg>
          </button>
        )}

        {/* Collapse/Expand toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
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

      {/* App name + timecode */}
      {!collapsed && (
        <div className="px-3 py-1 flex flex-col items-center gap-1">
          <span className="font-mono text-sm font-bold tracking-[0.35em] text-red-600 uppercase whitespace-nowrap">
            The Dictator
          </span>
          <TimecodeDisplay />
        </div>
      )}
    </aside>
  );
}
