import { createSignal, For, onMount, Show } from "solid-js";
import type { AgentMemory } from "../../../shared/ipc";
import { t } from "../i18n";

export function MemoryView() {
  const [memories, setMemories] = createSignal<AgentMemory[]>([]);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [selectedCategory, setSelectedCategory] = createSignal<string>("all");
  const [showAddModal, setShowAddModal] = createSignal(false);

  // Form signals
  const [newKey, setNewKey] = createSignal("");
  const [newContent, setNewContent] = createSignal("");
  const [newCategory, setNewCategory] = createSignal<
    "architecture" | "decision" | "preference" | "fact"
  >("fact");
  const [newTags, setNewTags] = createSignal("");

  const loadMemories = async () => {
    try {
      if (!window.sahkarmi?.memory) return;
      const category = selectedCategory() === "all" ? undefined : selectedCategory();
      const list = await window.sahkarmi.memory.list(category);
      setMemories(list);
    } catch (err) {
      console.error("Failed to load memories:", err);
    }
  };

  onMount(() => {
    void loadMemories();
  });

  const filteredMemories = () => {
    const q = searchQuery().toLowerCase().trim();
    return memories().filter((m) => {
      const matchesCat = selectedCategory() === "all" || m.category === selectedCategory();
      const matchesQuery =
        !q ||
        m.key.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q));
      return matchesCat && matchesQuery;
    });
  };

  const handleSave = async (e: Event) => {
    e.preventDefault();
    if (!newKey().trim() || !newContent().trim() || !window.sahkarmi?.memory) return;

    const tags = newTags()
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    await window.sahkarmi.memory.save({
      key: newKey().trim(),
      content: newContent().trim(),
      category: newCategory(),
      tags,
    });

    setNewKey("");
    setNewContent("");
    setNewTags("");
    setShowAddModal(false);
    await loadMemories();
  };

  const handleDelete = async (id: string) => {
    if (!window.sahkarmi?.memory) return;
    await window.sahkarmi.memory.delete(id);
    await loadMemories();
  };

  const categoryColor = (cat: string) => {
    switch (cat) {
      case "architecture":
        return "bg-blue-500/15 text-blue-400 border-blue-500/30";
      case "decision":
        return "bg-purple-500/15 text-purple-400 border-purple-500/30";
      case "preference":
        return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
      default:
        return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    }
  };

  return (
    <div class="h-full flex flex-col bg-[#0F1220] text-gray-200 overflow-hidden">
      {/* Header */}
      <div class="p-6 border-b border-[#212638] bg-[#141829] flex flex-wrap items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5">
            <span class="text-2xl">🧠</span>
            <h1 class="text-xl font-bold text-white">{t("memoryTitle")}</h1>
          </div>
          <p class="text-xs text-gray-400 mt-1">{t("memorySubtitle")}</p>
        </div>

        <div class="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search memory..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            class="px-3.5 py-1.5 rounded-xl bg-[#1A1F35] border border-[#2B314C] text-sm text-gray-200 focus:outline-none focus:border-amber-500 transition-colors placeholder:text-gray-500 w-56"
          />
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            class="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-all shadow-md shadow-amber-500/20 cursor-pointer"
          >
            + Add Memory
          </button>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div class="px-6 py-3 border-b border-[#212638] bg-[#121626] flex items-center gap-2 overflow-x-auto text-xs">
        <For each={["all", "architecture", "decision", "preference", "fact"]}>
          {(cat) => (
            <button
              type="button"
              onClick={() => {
                setSelectedCategory(cat);
                void loadMemories();
              }}
              class={`px-3 py-1 rounded-lg border capitalize transition-all cursor-pointer ${
                selectedCategory() === cat
                  ? "bg-amber-500/20 border-amber-500/50 text-amber-300 font-medium"
                  : "bg-[#181C2E] border-[#252B42] text-gray-400 hover:text-gray-200"
              }`}
            >
              {cat}
            </button>
          )}
        </For>
      </div>

      {/* Memory Cards Grid */}
      <div class="flex-1 overflow-y-auto p-6">
        <Show
          when={filteredMemories().length > 0}
          fallback={
            <div class="h-64 flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#282F48] rounded-2xl bg-[#131728]/50">
              <span class="text-3xl mb-2">📓</span>
              <p class="text-sm text-gray-400 max-w-md">{t("memoryEmpty")}</p>
            </div>
          }
        >
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <For each={filteredMemories()}>
              {(m) => (
                <div class="bg-[#161B2E] border border-[#252C46] hover:border-amber-500/30 rounded-xl p-4 flex flex-col justify-between transition-all group shadow-sm">
                  <div>
                    <div class="flex items-center justify-between gap-2 mb-2">
                      <h3 class="font-semibold text-sm text-white truncate">{m.key}</h3>
                      <span
                        class={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border capitalize ${categoryColor(
                          m.category,
                        )}`}
                      >
                        {m.category}
                      </span>
                    </div>
                    <p class="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap line-clamp-4">
                      {m.content}
                    </p>
                  </div>

                  <div class="pt-3 mt-3 border-t border-[#21273F] flex items-center justify-between text-[11px] text-gray-500">
                    <div class="flex flex-wrap gap-1">
                      <For each={m.tags}>
                        {(t) => (
                          <span class="px-1.5 py-0.5 bg-[#1E243D] text-gray-400 rounded text-[10px]">
                            #{t}
                          </span>
                        )}
                      </For>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(m.id)}
                      class="text-gray-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                      title="Delete memory"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Add Memory Modal */}
      <Show when={showAddModal()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div class="bg-[#181C2E] border border-[#2A3250] rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div class="flex items-center justify-between pb-3 border-b border-[#252C46]">
              <h3 class="font-bold text-white text-base">Save New Memory</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                class="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} class="space-y-4 pt-4 text-xs">
              <div>
                <label for="memory-key" class="block text-gray-300 mb-1 font-medium">
                  Memory Title / Key
                </label>
                <input
                  id="memory-key"
                  type="text"
                  required
                  placeholder="e.g. Auth Token Strategy"
                  value={newKey()}
                  onInput={(e) => setNewKey(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl bg-[#121626] border border-[#282F48] text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label for="memory-category" class="block text-gray-300 mb-1 font-medium">
                  Category
                </label>
                <select
                  id="memory-category"
                  value={newCategory()}
                  onChange={(e) => {
                    const val = e.currentTarget.value;
                    if (
                      val === "fact" ||
                      val === "decision" ||
                      val === "architecture" ||
                      val === "preference"
                    ) {
                      setNewCategory(val);
                    }
                  }}
                  class="w-full px-3 py-2 rounded-xl bg-[#121626] border border-[#282F48] text-white focus:outline-none focus:border-amber-500 capitalize"
                >
                  <option value="fact">Fact</option>
                  <option value="decision">Decision</option>
                  <option value="architecture">Architecture</option>
                  <option value="preference">Preference</option>
                </select>
              </div>

              <div>
                <label for="memory-content" class="block text-gray-300 mb-1 font-medium">
                  Content / Details
                </label>
                <textarea
                  id="memory-content"
                  required
                  rows={4}
                  placeholder="Describe the fact, standard, or decision to remember..."
                  value={newContent()}
                  onInput={(e) => setNewContent(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl bg-[#121626] border border-[#282F48] text-white focus:outline-none focus:border-amber-500 resize-none"
                />
              </div>

              <div>
                <label for="memory-tags" class="block text-gray-300 mb-1 font-medium">
                  Tags (comma-separated)
                </label>
                <input
                  id="memory-tags"
                  type="text"
                  placeholder="jwt, auth, security"
                  value={newTags()}
                  onInput={(e) => setNewTags(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl bg-[#121626] border border-[#282F48] text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  class="px-4 py-2 rounded-xl bg-[#232A44] hover:bg-[#2C3454] text-gray-300 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold cursor-pointer"
                >
                  Save Memory
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  );
}
