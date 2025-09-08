import { Plugin, SettingsTypes } from "@highlite/core";
import { ContextMenuManager } from "@highlite/core";

export default class MenuRGB extends Plugin {
    contextMenuManager: ContextMenuManager = new ContextMenuManager();
    pluginName = "MenuRGB";
    author: string = "Ellz";
    private _styleInjected = false;
    private _styleEl: HTMLStyleElement | null = null;
    // New simple observer dedicated to context menu containers
    private _menuObserver: MutationObserver | null = null;
    private _actions1Terms: Array<{ action: string; object?: string }> = [];
    private _actions2Terms: Array<{ action: string; object?: string }> = [];
    private _debug = false;
    private _menuProcessedCounts: WeakMap<HTMLElement, number> = new WeakMap();
    // (no-op) deliberately minimal state

    private infoText = [
            '- Enter one rule per comma or newline.',
            '- Rule format: "Action" or "Action|Object" (exact text, case-insensitive).',
            '- Examples: Deposit All, Deposit 1|Leather, Use|Evil Potion',
            '- If a rule appears in both lists, Actions 1 styling is used.'
        ].join('\n');

    constructor() {
        super();

        // Colors for Actions 1 and Actions 2
        this.settings.action1Color = {
            text: 'Action 1 Color',
            type: SettingsTypes.color,
            value: '#62ff00ff',
            callback: () => this.injectHighlightStyle(true),
        } as any;
        this.settings.action1HoverColor = {
            text: 'Hover 1 Color',
            type: SettingsTypes.color,
            value: '#ffd166',
            callback: () => this.injectHighlightStyle(true),
        } as any;
        this.settings.action2Color = {
            text: 'Action 2 Color',
            type: SettingsTypes.color,
            value: '#ff0000ff',
            callback: () => this.injectHighlightStyle(true),
        } as any;
        this.settings.action2HoverColor = {
            text: 'Hover 2 Color',
            type: SettingsTypes.color,
            value: '#99ddff',
            callback: () => this.injectHighlightStyle(true),
        } as any;
        

        this.settings.actionTextInfo = {
            text: 'Action Text Formatting',
            type: SettingsTypes.info,
            value: this.infoText,
            callback: () => {}
        } as any;
        // Two textareas: Actions 1 and Actions 2
        this.settings.actions1 = {
            text: 'Actions 1',
            type: SettingsTypes.textarea,
            value: '',
            callback: () => this.updateTermsFromSettings(),
        } as any;
        this.settings.actions2 = {
            text: 'Actions 2',
            type: SettingsTypes.textarea,
            value: '',
            callback: () => this.updateTermsFromSettings(),
        } as any;

        // Seed terms from defaults
        this.updateTermsFromSettings();
    }

    init(): void {
        this.settings.actionTextInfo.value = this.infoText}
    start(): void {
        this.updateTermsFromSettings(); // ensure terms are updated for current account
        this.log("MenuRGB started");
        if (this._debug) this.log("Debug mode enabled");
        this.injectHighlightStyle();
        if (this._debug) this.log("Style injected");

        const ok = this.contextMenuManager.registerContextHook(
            'ContextMenuItemManager',
            '_createInventoryItemContextMenuItems',
            (_args: any[], ret: any) => {
                // Prefer working from the returned items to avoid scanning the whole document
                this.processInventoryItems(ret);
                return ret;
            }
        );
        if (this._debug) this.log(`Hook ContextMenuItemManager._createInventoryItemContextMenuItems: ${ok}`);

        // Install a lightweight DOM observer that targets the concrete menu container
        this.installMenuContainerObserver();
    }

    stop(): void {
        // Disconnect the menu MutationObserver to stop watching the DOM
        if (this._menuObserver) {
            try {
                this._menuObserver.disconnect();
                if (this._debug) this.log('Menu container observer disconnected');
            } catch {}
            this._menuObserver = null;
        }
        // Best-effort unregister of context hook if API supports it
        try {
            (this.contextMenuManager as any)?.unregisterContextHook?.(
                'ContextMenuItemManager',
                '_createInventoryItemContextMenuItems'
            );
        } catch {}
        // Clear any processed counts (if present)
        try { (this as any)._menuProcessedCounts?.clear?.(); } catch {}
        // Remove data markers and classes we added
        try {
            // Unmark rows
            const marked = document.querySelectorAll('[data-mrgb-marked]');
            marked.forEach((el) => {
                try {
                    (el as HTMLElement).classList?.remove('mrgb-action-item');
                    (el as HTMLElement).classList?.remove('mrgb-g1');
                    (el as HTMLElement).classList?.remove('mrgb-g2');
                    if ((el as any).dataset) delete (el as any).dataset.mrgbMarked;
                } catch {}
            });
            // Remove action-only span class
            document.querySelectorAll('.mrgb-action-only').forEach((el) => {
                try { (el as HTMLElement).classList.remove('mrgb-action-only'); } catch {}
            });
        } catch {}
        // Remove injected style tag and reset flags
        if (this._styleEl) {
            try {
                this._styleEl.remove();
                if (this._debug) this.log('Injected style removed');
            } catch {}
            this._styleEl = null;
        }
        // Also remove any stray injected styles in shadow roots
        try {
            document.querySelectorAll('style[data-menurgb]')
                .forEach((n) => { try { n.remove(); } catch {} });
            // scan shadow roots
            (document.querySelectorAll('*') as any).forEach((el: any) => {
                const sr = el && el.shadowRoot;
                if (sr && sr.querySelectorAll) {
                    sr.querySelectorAll('style[data-menurgb]')
                      .forEach((n: Element) => { try { (n as HTMLElement).remove(); } catch {} });
                }
            });
        } catch {}
        this._styleInjected = false;
        this.log("MenuRGB stopped");
    }

    private injectHighlightStyle(force: boolean = false) {
        const a1 = ((this.settings as any).action1Color?.value as string) || '#44ff00ff';
        const h1 = ((this.settings as any).action1HoverColor?.value as string) || a1;
        const a2 = ((this.settings as any).action2Color?.value as string) || '#ff0000ff';
        const h2 = ((this.settings as any).action2HoverColor?.value as string) || a2;
        if (this._styleInjected && !force && this._styleEl) return;
        if (!this._styleEl) {
            const existing = document.querySelector('style[data-menurgb]') as HTMLStyleElement | null;
            if (existing) {
                this._styleEl = existing;
            } else {
                this._styleEl = document.createElement('style');
                this._styleEl.setAttribute('data-menurgb', 'true');
                document.head.appendChild(this._styleEl);
            }
        }
        if (this._styleEl) {
            this._styleEl.textContent = `
                :root {
                    --mrgb-action1: ${a1};
                    --mrgb-hover1: ${h1};
                    --mrgb-action2: ${a2};
                    --mrgb-hover2: ${h2};
                }
                .mrgb-action-item.mrgb-g1 .mrgb-action-only { color: var(--mrgb-action1) !important; -webkit-text-fill-color: var(--mrgb-action1) !important; }
                .mrgb-action-item.mrgb-g1:hover .mrgb-action-only { color: var(--mrgb-hover1) !important; -webkit-text-fill-color: var(--mrgb-hover1) !important; }
                .mrgb-action-item.mrgb-g2 .mrgb-action-only { color: var(--mrgb-action2) !important; -webkit-text-fill-color: var(--mrgb-action2) !important; }
                .mrgb-action-item.mrgb-g2:hover .mrgb-action-only { color: var(--mrgb-hover2) !important; -webkit-text-fill-color: var(--mrgb-hover2) !important; }
            `;
        }
        this._styleInjected = true;
        if (this._debug) this.log(`Colors: a1=${a1}, h1=${h1}, a2=${a2}, h2=${h2}`);
    }

    // Legacy observer removed; using installMenuContainerObserver instead.

    // Simpler logic that matches your desired approach exactly.
    // Watches for `.hs-context-menu__items-container` and highlights rows
    // by comparing the action name (and optional entity name) to settings.
    private installMenuContainerObserver() {
        if (this._menuObserver) return;
        try {
            const scanContainer = (root: Element | Document) => {
                // Try ID first, then class selector
                const doc = (root instanceof Document ? root : (root as Element).ownerDocument) || document;
                const idEl = doc.getElementById('hs-context-menu__items-container');
                if (idEl) this.simpleHighlightInventoryMenu(idEl as HTMLElement);
                const classEls = doc.querySelectorAll?.('.hs-context-menu__items-container') || [];
                (Array.from(classEls) as Element[]).forEach((c) => this.simpleHighlightInventoryMenu(c as HTMLElement));
            };

            // Initial pass in case a menu is already open
            scanContainer(document);

            this._menuObserver = new MutationObserver((muts) => {
                for (const m of muts) {
                    // React to visibility/attribute changes as well as child additions
                    if (m.type === 'attributes') {
                        const tgt = m.target as Element;
                        const container = tgt.closest?.('.hs-context-menu__items-container') || (tgt.id === 'hs-context-menu__items-container' ? tgt : null);
                        if (container) this.simpleHighlightInventoryMenu(container as HTMLElement);
                    }
                    m.addedNodes.forEach((n) => {
                        if (!(n instanceof Element)) return;
                        // If a container itself was added
                        if ((n as Element).id === 'hs-context-menu__items-container') {
                            this.simpleHighlightInventoryMenu(n as HTMLElement);
                        } else if (n.classList && n.classList.contains('hs-context-menu__items-container')) {
                            this.simpleHighlightInventoryMenu(n as HTMLElement);
                        } else {
                            // Or if a subtree contains one
                            const subById = n.querySelector?.('#hs-context-menu__items-container');
                            if (subById) this.simpleHighlightInventoryMenu(subById as HTMLElement);
                            const subByClass = n.querySelector?.('.hs-context-menu__items-container');
                            if (!subById && subByClass) this.simpleHighlightInventoryMenu(subByClass as HTMLElement);
                            // Or if the node is a child within an existing container
                            const parentById = n.closest?.('#hs-context-menu__items-container');
                            if (parentById) this.simpleHighlightInventoryMenu(parentById as HTMLElement);
                            const parentByClass = n.closest?.('.hs-context-menu__items-container');
                            if (!parentById && parentByClass) this.simpleHighlightInventoryMenu(parentByClass as HTMLElement);
                        }
                    });
                }
            });
            this._menuObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style','class','hidden','aria-hidden'] });
            if (this._debug) this.log('Menu container observer installed');
        } catch (e) {
            if (this._debug) this.log(`Failed to install menu observer: ${e}`);
        }
    }

    // Iterate container children and apply highlight based on settings
    private simpleHighlightInventoryMenu(container: HTMLElement) {
        try {
            // Only work if visible and has children
            if (!this.isVisible(container) || container.children.length === 0) return;
            const items = Array.from(container.children) as HTMLElement[];
            for (const item of items) {
                if (!(item instanceof HTMLElement)) continue;
                if (item.dataset && (item.dataset as any).mrgbMarked) continue;
        
                const isItem = item.classList.contains('hs-context-menu__item');
                if (!isItem) continue;

                // Support both single-underscore and double-underscore class variants
                const actionEl = item.querySelector('.hs-context-menu__item_action-name, .hs-context-menu__item__action-name') as HTMLElement | null;
                if (!actionEl) continue;
                const entityEl = item.querySelector('.hs-context-menu__item_entity-name, .hs-context-menu__item__entity-name') as HTMLElement | null;

                const action = (actionEl.textContent || '').trim();
                const entity = (entityEl?.textContent || '').trim();

                const grp = this.getHighlightGroup(action, entity);
                if (grp === 1 || grp === 2) {
                    this.applyActionClasses(item, actionEl, grp);
                    if (item.dataset) (item.dataset as any).mrgbMarked = '1';
                    if (this._debug) this.log(`Highlighted[g${grp}]: action="${action}" entity="${entity}"`);
                }
            }
            this._menuProcessedCounts.set(container, container.children.length);
        } catch (e) {
            if (this._debug) this.log(`simpleHighlightInventoryMenu error: ${e}`);
        }
    }

    // Return group 1 or 2 if matched; 1 has priority when duplicated
    private getHighlightGroup(action: string, entity: string | null | undefined): 0 | 1 | 2 {
        const a = this.normalize(action).toLowerCase();
        const e = this.normalize(entity || '').toLowerCase();
        if (!a) return 0;
        // Actions 1 first
        for (const t of this._actions1Terms) {
            const ta = this.normalize(t.action).toLowerCase();
            if (a !== ta) continue;
            if (!t.object) return 1;
            const to = this.normalize(t.object).toLowerCase();
            if (to && e === to) return 1;
        }
        // Then Actions 2
        for (const t of this._actions2Terms) {
            const ta = this.normalize(t.action).toLowerCase();
            if (a !== ta) continue;
            if (!t.object) return 2;
            const to = this.normalize(t.object).toLowerCase();
            if (to && e === to) return 2;
        }
        return 0;
    }

    private isVisible(el: HTMLElement): boolean {
        try {
            const style = (el.ownerDocument?.defaultView || window).getComputedStyle(el);
            if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        } catch {
            return true;
        }
    }

    // Legacy tagDepositAllElements removed.

    // Preferred path: operate on returned items from the hook
    private processInventoryItems(ret: any) {
        const items: any[] = Array.isArray(ret) ? ret : [];
        if (!items.length) return;
        const processed = new Set<any>();
        const attempt = (remaining: number) => {
            try {
                for (const it of items) {
                    if (processed.has(it)) continue;
                    const el: HTMLElement | undefined = (it?._element || it?.element || it?.el) as any;
                    if (!el) continue; // wait for element
                    const row = this.getRowEl(el);
                    const spans = this.findMenuSpans(row);
                    const actionText = spans.action?.textContent?.trim() || this.getLabel(row);
                    const objectText = spans.object?.textContent?.trim() || '';
                    const grp = this.getHighlightGroup(actionText, objectText);
                    if ((grp === 1 || grp === 2) && spans.action) {
                        this.applyActionClasses(row, spans.action, grp);
                        processed.add(it);
                        if ((row as any).dataset) (row as any).dataset.mrgbMarked = '1';
                    }
                }
                if (processed.size === items.length || remaining <= 0) return;
            } catch (e) {
                if (this._debug) this.log(`processInventoryItems error: ${e}`);
            }
            setTimeout(() => attempt(remaining - 1), 50); // poll up to ~500ms
        };
        // Allow labels to populate before first attempt
        requestAnimationFrame(() => requestAnimationFrame(() => attempt(10)));
    }

    // Legacy scanInventoryMenu removed.

    private getLabel(el: Element): string {
        const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
        const t = (el.textContent || '').toString();
        const it = (el as HTMLElement).innerText || '';
        return (t || it || aria).replace(/[\u00A0\s]+/g, ' ').trim();
    }

    private applyActionClasses(row: HTMLElement, actionSpan: HTMLElement, group: 1 | 2) {
        try {
            row.classList.add('mrgb-action-item');
            row.classList.add(group === 1 ? 'mrgb-g1' : 'mrgb-g2');
            actionSpan.classList.add('mrgb-action-only');
            // If the row is in a shadow root, ensure CSS exists there too
            const root: any = (row as any).getRootNode && (row as any).getRootNode();
            if (root && root !== document && root.querySelector && !root.querySelector('style[data-menurgb]')) {
                const style = document.createElement('style');
                style.setAttribute('data-menurgb', 'true');
                const a1 = ((this.settings as any).action1Color?.value as string) || '#ffffff';
                const h1 = ((this.settings as any).action1HoverColor?.value as string) || a1;
                const a2 = ((this.settings as any).action2Color?.value as string) || '#66ccff';
                const h2 = ((this.settings as any).action2HoverColor?.value as string) || a2;
                style.textContent = `
                    .mrgb-action-item.mrgb-g1 .mrgb-action-only { color: ${a1} !important; -webkit-text-fill-color: ${a1} !important; }
                    .mrgb-action-item.mrgb-g1:hover .mrgb-action-only { color: ${h1} !important; -webkit-text-fill-color: ${h1} !important; }
                    .mrgb-action-item.mrgb-g2 .mrgb-action-only { color: ${a2} !important; -webkit-text-fill-color: ${a2} !important; }
                    .mrgb-action-item.mrgb-g2:hover .mrgb-action-only { color: ${h2} !important; -webkit-text-fill-color: ${h2} !important; }
                `;
                root.appendChild(style);
            }
        } catch (e) {
            if (this._debug) this.log(`applyActionClasses error: ${e}`);
        }
    }

    private findMenuSpans(row: HTMLElement): { action?: HTMLElement, object?: HTMLElement } {
        const action = (row.querySelector('.hs-context-menu__item_action-name, .hs-context-menu__item__action-name') || row.querySelector('[class*="action-name"]')) as HTMLElement | null;
        const object = (row.querySelector('.hs-context-menu__item_entity-name, .hs-context-menu__item__entity-name') || row.querySelector('[class*="entity"][class*="name"]')) as HTMLElement | null;
        return { action: action || undefined, object: object || undefined };
    }

    private getRowEl(el: HTMLElement): HTMLElement {
        return (el.closest && (el.closest('[role="menuitem"],[role="option"]') as HTMLElement)) || el;
    }

    private normalize(s: string): string {
        return s
            .replace(/[\n\r\t]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private parseList(input: string): Array<{ action: string; object?: string }> {
        const raw = (input || '').split(/[,\n]+/);
        const out: Array<{ action: string; object?: string }> = [];
        for (let r of raw) {
            r = this.normalize(r);
            if (!r) continue;
            // allow action|object pairs
            const parts = r.split('|').map((p) => this.normalize(p));
            if (parts.length >= 2 && parts[0] && parts[1]) {
                out.push({ action: parts[0], object: parts[1] });
            } else {
                out.push({ action: parts[0] });
            }
        }
        return out;
    }

    private updateTermsFromSettings() {
        try {
            this._actions1Terms = this.parseList(String((this.settings as any).actions1?.value ?? ''));
            this._actions2Terms = this.parseList(String((this.settings as any).actions2?.value ?? ''));
            this.log(`Updated terms. Actions1: ${this._actions1Terms.length}, Actions2: ${this._actions2Terms.length}`);
            if (this._debug) this.log(`Actions1 terms parsed: ${JSON.stringify(this._actions1Terms).slice(0,200)}`);
        } catch (e) {
            this.log(`Failed to parse terms: ${e}`);
        }
    }
}
