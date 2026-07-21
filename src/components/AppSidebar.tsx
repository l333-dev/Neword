import type { OutlineItem } from "../features/editor/outline";

type AppSidebarProps = {
  items: OutlineItem[];
  className?: string;
  onSelectItem?: (item: OutlineItem) => void;
};

export function AppSidebar({ items, className, onSelectItem }: AppSidebarProps) {
  return (
    <aside
      className={["sidebar", className].filter(Boolean).join(" ")}
      aria-label="文書アウトライン"
    >
      <h2>アウトライン</h2>
      {items.length === 0 ? <p className="muted">見出しはまだありません。</p> : null}
      {items.map((item) => (
        <div
          key={item.id}
          className={`outline-item level-${item.level}`}
          onClick={onSelectItem ? () => onSelectItem(item) : undefined}
        >
          {item.text}
        </div>
      ))}
    </aside>
  );
}
