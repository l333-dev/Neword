import type { OutlineItem } from "../features/editor/outline";

type AppSidebarProps = {
  items: OutlineItem[];
  className?: string;
  activeItemId?: string | null;
  onSelectItem?: (item: OutlineItem) => void;
};

export function AppSidebar({ items, className, activeItemId, onSelectItem }: AppSidebarProps) {
  return (
    <aside
      className={["sidebar", className].filter(Boolean).join(" ")}
      aria-label="文書アウトライン"
    >
      <h2>アウトライン</h2>
      {items.length === 0 ? <p className="muted">見出しはまだありません。</p> : null}
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          className={`outline-item level-${item.level} ${activeItemId === item.id ? "active" : ""}`}
          onClick={onSelectItem ? () => onSelectItem(item) : undefined}
          title={item.text}
        >
          {item.text}
        </button>
      ))}
    </aside>
  );
}
