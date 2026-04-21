export const navItems = [
  "Planification d'activites",
  "Disponibilites personnel",
  "Disponibilites aeronefs",
  "Disponibilite simulateur",
  "Suivi de parcours de qualification",
  "EQA/TPA",
  "Contraintes",
  "Parametres"
] as const;

export type NavigationItem = (typeof navItems)[number] | "Conduite de l'activite";

type TopNavProps = {
  activeItem: NavigationItem;
  onChange: (item: NavigationItem) => void;
  items?: readonly NavigationItem[];
};

export function TopNav({ activeItem, onChange, items = navItems }: TopNavProps) {
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
