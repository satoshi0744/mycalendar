import type { ViewMode } from '../data/types';
import './ViewSwitcher.css';

interface Props {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const modes: { value: ViewMode; label: string }[] = [
  { value: 'year', label: '年' },
  { value: 'month', label: '月' },
  { value: 'week', label: '週' },
  { value: 'day', label: '日' },
];

export default function ViewSwitcher({ viewMode, onChange }: Props) {
  return (
    <div className="view-switcher" role="tablist">
      {modes.map(m => (
        <button
          key={m.value}
          className={`view-switcher-btn ${viewMode === m.value ? 'active' : ''}`}
          onClick={() => onChange(m.value)}
          role="tab"
          aria-selected={viewMode === m.value}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
