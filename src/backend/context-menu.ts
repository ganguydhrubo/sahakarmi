import { type ContextMenuParams, clipboard, Menu, type MenuItemConstructorOptions } from "electron";

/** Only a link a person could open is offered for copying. */
function copyableLink(url: string): string | null {
  return /^(https?|mailto):/i.test(url) ? url : null;
}

/**
 * The usual right-click menu: what a person expects in Chrome or Edge, built from what was
 * clicked. It only offers actions; it never changes how a page loads or what it may do.
 */
export function contextMenuItems(
  params: Pick<
    ContextMenuParams,
    | "selectionText"
    | "isEditable"
    | "linkURL"
    | "editFlags"
    | "misspelledWord"
    | "dictionarySuggestions"
  >,
  page: { canGoBack: boolean; canGoForward: boolean } | null,
  actions: {
    replaceMisspelling: (word: string) => void;
    back: () => void;
    forward: () => void;
    reload: () => void;
  },
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  const add = (...group: MenuItemConstructorOptions[]) => {
    if (group.length === 0) return;
    if (items.length > 0) items.push({ type: "separator" });
    items.push(...group);
  };
  if (params.isEditable && params.misspelledWord) {
    add(
      ...params.dictionarySuggestions.slice(0, 4).map(
        (word): MenuItemConstructorOptions => ({
          label: word,
          click: () => actions.replaceMisspelling(word),
        }),
      ),
    );
  }
  const link = copyableLink(params.linkURL);
  if (link) add({ label: "Copy link address", click: () => clipboard.writeText(link) });
  if (params.isEditable) {
    add(
      { role: "undo", enabled: params.editFlags.canUndo },
      { role: "redo", enabled: params.editFlags.canRedo },
    );
    add(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "selectAll" },
    );
  } else if (params.selectionText.trim()) {
    add({ role: "copy" }, { role: "selectAll" });
  } else {
    add({ role: "selectAll" });
  }
  if (page && !params.isEditable && !params.selectionText.trim() && !link) {
    add(
      { label: "Back", enabled: page.canGoBack, click: actions.back },
      { label: "Forward", enabled: page.canGoForward, click: actions.forward },
      { label: "Reload", click: actions.reload },
    );
  }
  return items;
}

/** Adds the right-click menu to the app window, or to a browser page with Back and Reload. */
export function attachContextMenu(
  contents: Electron.WebContents,
  options: { navigation: boolean },
): void {
  contents.on("context-menu", (_event, params) => {
    const history = contents.navigationHistory;
    const items = contextMenuItems(
      params,
      options.navigation
        ? { canGoBack: history.canGoBack(), canGoForward: history.canGoForward() }
        : null,
      {
        replaceMisspelling: (word) => contents.replaceMisspelling(word),
        back: () => history.canGoBack() && history.goBack(),
        forward: () => history.canGoForward() && history.goForward(),
        reload: () => contents.reload(),
      },
    );
    if (items.length > 0) Menu.buildFromTemplate(items).popup();
  });
}
