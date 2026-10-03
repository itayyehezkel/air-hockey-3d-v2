import { isUnlocked } from '../game/Skins';
import { hasFresh, isFresh } from '../game/Stats';
import newBadgeUrl from '../assets/ui/levelup/badge_new.webp';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

export type LockerTab = 'mallets' | 'pucks' | 'tables';
/** Tabs with items (a tab without a list yet shows "coming soon"). */
export type LockerKind = LockerTab;

/** The item kind of a tab (the save's "kind:id" keys use it). */
const ITEM_KIND = { mallets: 'mallet', pucks: 'puck', tables: 'table' } as const;

interface CardSkin {
  id: string;
  name: string;
  unlockLevel: number;
}

interface CardList {
  skins: CardSkin[];
  equipped: string;
  thumbs: Map<string, string>;
}

/**
 * Locker screen DOM: tabs and a grid of cards built from sprite frames (card / selected / locked)
 * with plain-text labels, so names and levels are easy to edit.
 */
export class LockerUI {
  private readonly grid = $('lockerGrid');
  private readonly pedestal = $('lockerPedestal');
  private readonly tabs = [...document.querySelectorAll<HTMLButtonElement>('.locker-tab')];
  private currentTab: LockerTab = 'mallets';
  private readonly lists: Partial<Record<LockerKind, CardList>> = {};

  onSelect: (kind: LockerKind, id: string) => void = () => {};
  onTab: (tab: LockerTab) => void = () => {};
  onButton: () => void = () => {};

  constructor() {
    for (const t of this.tabs) {
      t.addEventListener('click', () => {
        this.onButton();
        this.setTab(t.dataset.tab as LockerTab);
      });
    }
  }

  /** The open tab (it stays selected between Locker visits). */
  get tab(): LockerTab {
    return this.currentTab;
  }

  pedestalRect(): DOMRect | null {
    const r = this.pedestal.getBoundingClientRect();
    return r.width > 0 ? r : null;
  }

  render(kind: LockerKind, skins: CardSkin[], equipped: string, thumbs: Map<string, string>): void {
    this.lists[kind] = { skins, equipped, thumbs };
    // A red dot on every tab that still has an unlocked item the player hasn't equipped.
    for (const t of this.tabs) t.classList.toggle('has-new', hasFresh(ITEM_KIND[t.dataset.tab as LockerTab]));
    if (this.currentTab !== kind) return;
    this.grid.replaceChildren(
      ...skins.map((skin) => {
        const open = isUnlocked(skin);
        const card = document.createElement('button');
        card.className = `locker-card${skin.id === equipped ? ' selected' : ''}${open ? '' : ' locked'}`;
        card.dataset.id = skin.id;
        card.setAttribute('aria-label', `${skin.name}${open ? '' : `, unlocks at level ${skin.unlockLevel}`}`);

        const img = document.createElement('img');
        img.className = 'card-thumb';
        img.alt = '';
        img.draggable = false;
        const url = thumbs.get(skin.id);
        if (url) img.src = url;
        else img.classList.add('pending');

        const name = document.createElement('span');
        name.className = skin.name.length > 8 ? 'card-name long' : 'card-name';
        name.textContent = skin.name;

        card.append(img, name);
        // Unlocked but never equipped: a NEW! badge (the LEVEL UP popup's), until the player equips it.
        if (open && isFresh(`${ITEM_KIND[kind]}:${skin.id}`)) {
          const badge = document.createElement('img');
          badge.className = 'card-new';
          badge.src = newBadgeUrl;
          badge.alt = 'new';
          badge.draggable = false;
          card.append(badge);
        }
        // The selected frame marks the equipped skin; only locked cards carry a tag.
        if (!open) {
          const tag = document.createElement('span');
          tag.className = 'card-tag level';
          tag.innerHTML = '<i class="card-lock"></i>';
          tag.append(`LEVEL ${skin.unlockLevel}`);
          card.append(tag);
        }
        card.addEventListener('click', () => {
          if (!open || skin.id === equipped) return;
          this.onButton();
          this.onSelect(kind, skin.id);
        });
        return card;
      }),
    );
  }

  /** A thumbnail finished rendering: drop it into its card (if that tab is showing). */
  setThumb(kind: LockerKind, id: string, url: string): void {
    if (this.currentTab !== kind) return;
    const img = this.grid.querySelector<HTMLImageElement>(`.locker-card[data-id="${id}"] .card-thumb`);
    if (!img) return;
    img.src = url;
    img.classList.remove('pending');
  }

  private setTab(tab: LockerTab): void {
    this.currentTab = tab;
    for (const t of this.tabs) t.classList.toggle('active', t.dataset.tab === tab);
    const list = this.lists[tab];
    if (list) {
      this.render(tab, list.skins, list.equipped, list.thumbs);
    } else {
      const soon = document.createElement('div');
      soon.className = 'locker-soon';
      soon.textContent = 'COMING SOON';
      this.grid.replaceChildren(soon);
    }
    this.onTab(tab);
  }
}
