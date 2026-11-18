import { useEffect, useState } from 'react';
import HarmonyTool from './HarmonyTool';
import ResizeTool from './resize/ResizeTool';

const TABS = [
  { id: 'harmony', label: 'Hue harmony', title: 'Hue Harmony' },
  { id: 'resize', label: 'Resize & pad', title: 'Resize & Pad' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const fromHash = (): TabId => (location.hash === '#resize' ? 'resize' : 'harmony');

export default function App() {
  const [tab, setTab] = useState<TabId>(fromHash);

  useEffect(() => {
    const onHash = () => setTab(fromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.title = `${TABS.find((t) => t.id === tab)!.title} · Color Grading Helper`;
  }, [tab]);

  return (
    <div className="app">
      <header className="top">
        <h1>Color Grading Helper</h1>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''}>
              {t.label}
            </a>
          ))}
        </nav>
      </header>
      {/* Both tools stay mounted so switching tabs keeps your work. */}
      <div hidden={tab !== 'harmony'}>
        <HarmonyTool />
      </div>
      <div hidden={tab !== 'resize'}>
        <ResizeTool />
      </div>
    </div>
  );
}
