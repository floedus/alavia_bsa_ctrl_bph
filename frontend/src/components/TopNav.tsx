export type AppNavigationItem =
  | "Planification BPH"
  | "Controleurs"
  | "Vue flotte"
  | "Documents"
  | "Parametres"
  | "Utilisateurs";

export const appNavItems: readonly AppNavigationItem[] = [
  "Planification BPH",
  "Controleurs",
  "Vue flotte",
  "Documents",
  "Parametres",
  "Utilisateurs"
] as const;

type Props = {
  activeItem: AppNavigationItem;
  onChange: (item: AppNavigationItem) => void;
  items?: readonly AppNavigationItem[];
};

export function TopNav({ activeItem, onChange, items = appNavItems }: Props) {
  return (
    <nav className="top-nav" aria-label="Navigation principale">
      {items.map((item) => (
        <button
          key={item}
          className={item === activeItem ? "nav-item active" : "nav-item"}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </nav>
  );
}
