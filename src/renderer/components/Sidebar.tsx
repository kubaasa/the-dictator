import { useState } from 'react';

type View = 'home' | 'modes';

interface SidebarProps {
  activeView: View;
  onNavigate: (view: View) => void;
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
    label: 'Modes',
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
      </svg>
    ),
  },
];

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`flex flex-col gap-1 border-r border-zinc-800/60 py-3 transition-all duration-300 overflow-hidden ${collapsed ? 'w-14' : 'w-1/5'}`}>
      {navItems.map((item) => {
        const isActive = item.id === activeView;
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            title={collapsed ? item.label : undefined}
            className={`flex flex-row items-center gap-3 rounded-lg px-3 py-2 w-full transition-colors ${
              isActive ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'
            }`}
          >
            {item.icon}
            {!collapsed && <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>}
          </button>
        );
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Toggle button */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center justify-center rounded-lg px-3 py-2 w-full text-zinc-600 hover:text-zinc-400 transition-colors"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
        {!collapsed && <span className="ml-3 text-xs font-medium whitespace-nowrap">Collapse</span>}
      </button>

      {/* App name */}
      {!collapsed && (
        <div className="px-3 py-1 flex justify-center">
          <span className="text-sm font-semibold tracking-wide text-zinc-600 uppercase whitespace-nowrap">
            The Dictator
          </span>
        </div>
      )}
    </aside>
  );
}
