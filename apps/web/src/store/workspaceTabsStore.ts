import { create } from 'zustand';

export interface WorkspaceTab {
  id: string;
  path: string;
  label: string;
}

interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  activePath: string | null;
  openTab: (tab: WorkspaceTab) => void;
  closeTab: (path: string) => void;
  activateTab: (path: string) => void;
}

const DEFAULT_TAB: WorkspaceTab = {
  id: 'dashboard-home',
  path: '/dashboard',
  label: '概览',
};

export const useWorkspaceTabsStore = create<WorkspaceTabsState>((set, get) => ({
  tabs: [DEFAULT_TAB],
  activePath: DEFAULT_TAB.path,

  openTab: (tab) => {
    const state = get();
    const exists = state.tabs.some((item) => item.path === tab.path);
    set({
      tabs: exists
        ? state.tabs.map((item) =>
            item.path === tab.path ? { ...item, label: tab.label } : item,
          )
        : [...state.tabs, tab],
      activePath: tab.path,
    });
  },

  closeTab: (path) => {
    const state = get();
    const nextTabs = state.tabs.filter((tab) => tab.path !== path);

    if (!nextTabs.length) {
      set({ tabs: [DEFAULT_TAB], activePath: DEFAULT_TAB.path });
      return;
    }

    const nextActive =
      state.activePath === path ? nextTabs[nextTabs.length - 1].path : state.activePath;

    set({ tabs: nextTabs, activePath: nextActive });
  },

  activateTab: (path) => {
    set({ activePath: path });
  },
}));
