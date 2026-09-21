// 記事一覧 (トップページ) の検索・タグ絞り込み・並べ替え。
// 対象の DOM は SearchBox / TagFilter / SortControls と、index.astro の #article-list / #no-results / #result-count。
// 状態は URL (?q= / ?tag= / ?mode=or / ?sort=) に反映し、読み込み時に復元する。

const searchInput = document.getElementById(
  "search-input",
) as HTMLInputElement | null;
const articleList = document.getElementById("article-list")!;
const noResults = document.getElementById("no-results")!;
const resultCount = document.getElementById("result-count");
const items = Array.from(articleList.querySelectorAll<HTMLElement>("li"));

const tagToggle = document.getElementById(
  "tag-filter-toggle",
) as HTMLButtonElement | null;
const tagPanel = document.getElementById("tag-filter-panel");
const tagBadge = document.getElementById("tag-filter-badge");
const tagFilters = document.getElementById("tag-filters");
const modeControls = document.getElementById("tag-mode-controls");
const tagClear = document.getElementById("tag-clear");
const allChip = tagFilters?.querySelector<HTMLElement>("[data-tag='all']");
const tagChips = Array.from(
  tagFilters?.querySelectorAll<HTMLButtonElement>(
    "[data-tag]:not([data-tag='all'])",
  ) ?? [],
);
const totalTagCount = tagChips.length;
const knownTags = new Set(tagChips.map((c) => c.dataset.tag!));
const sortButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("#sort-controls .sort-btn"),
);
const validSorts = new Set(sortButtons.map((b) => b.dataset.sort!));

const DEFAULT_SORT = "date-desc";
const selectedTags = new Set<string>();
let tagMode: "and" | "or" = "and";
let activeSort = DEFAULT_SORT;

function setPanelOpen(open: boolean) {
  tagToggle?.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) tagPanel?.removeAttribute("hidden");
  else tagPanel?.setAttribute("hidden", "");
}

// Reflect the tag selection state onto the chips / badge / controls
function renderTagUI() {
  const count = selectedTags.size;
  tagChips.forEach((chip) => {
    const on = selectedTags.has(chip.dataset.tag!);
    chip.classList.toggle("active", on);
    chip.setAttribute("aria-pressed", on ? "true" : "false");
  });
  allChip?.classList.toggle("active", count === 0);
  allChip?.setAttribute("aria-pressed", count === 0 ? "true" : "false");

  if (tagBadge) {
    tagBadge.textContent =
      count === 0
        ? `${totalTagCount}個`
        : count === 1
          ? `#${[...selectedTags][0]}`
          : `${count}個選択中`;
  }
  tagToggle?.classList.toggle("has-filter", count > 0);

  // AND / OR only makes sense with two or more tags
  if (modeControls) modeControls.hidden = count < 2;
  modeControls
    ?.querySelectorAll<HTMLButtonElement>("[data-mode]")
    .forEach((btn) => {
      const on = btn.dataset.mode === tagMode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  if (tagClear) tagClear.hidden = count === 0;
}

// Keep the current filter / sort / search in the URL (shareable, survives reload)
function syncUrl() {
  const params = new URLSearchParams();
  const query = searchInput?.value.trim();
  if (query) params.set("q", query);
  // chip order keeps the URL stable regardless of click order
  tagChips.forEach((chip) => {
    if (selectedTags.has(chip.dataset.tag!)) {
      params.append("tag", chip.dataset.tag!);
    }
  });
  if (selectedTags.size > 1 && tagMode === "or") params.set("mode", "or");
  if (activeSort !== DEFAULT_SORT) params.set("sort", activeSort);
  const qs = params.toString();
  try {
    history.replaceState(
      null,
      "",
      `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`,
    );
  } catch {
    // history API unavailable (e.g. sandboxed) - the filter still works
  }
}

function restoreFromUrl() {
  const params = new URLSearchParams(location.search);
  params.getAll("tag").forEach((t) => {
    if (knownTags.has(t)) selectedTags.add(t);
  });
  tagMode = params.get("mode") === "or" ? "or" : "and";
  const sort = params.get("sort");
  if (sort && validSorts.has(sort)) activeSort = sort;
  sortButtons.forEach((b) => {
    b.classList.toggle("active", b.dataset.sort === activeSort);
  });
  if (searchInput) searchInput.value = params.get("q") ?? "";
  if (selectedTags.size > 0) setPanelOpen(true);
}

function update() {
  filterAndSort();
  syncUrl();
}

// Search
searchInput?.addEventListener("input", update);

// Tag filter panel toggle
tagToggle?.addEventListener("click", () => {
  setPanelOpen(tagToggle.getAttribute("aria-expanded") !== "true");
});

// Tag chips: click toggles a tag, "all" clears the selection
tagFilters?.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-tag]");
  if (!btn) return;
  const tag = btn.dataset.tag!;
  if (tag === "all") {
    selectedTags.clear();
  } else if (selectedTags.has(tag)) {
    selectedTags.delete(tag);
  } else {
    selectedTags.add(tag);
  }
  renderTagUI();
  update();
});

modeControls?.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-mode]");
  if (!btn) return;
  tagMode = btn.dataset.mode === "or" ? "or" : "and";
  renderTagUI();
  update();
});

tagClear?.addEventListener("click", () => {
  selectedTags.clear();
  renderTagUI();
  update();
});

// Sort
document.getElementById("sort-controls")?.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".sort-btn");
  if (!btn) return;
  sortButtons.forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  activeSort = btn.dataset.sort || DEFAULT_SORT;
  update();
});

function filterAndSort() {
  const query = searchInput?.value.toLowerCase() || "";
  const wanted = [...selectedTags].map((t) => t.toLowerCase());

  // Filter
  const visible = items.filter((item) => {
    const title = item.getAttribute("data-title") || "";
    const tags = item.getAttribute("data-tags") || "";
    const matchesSearch =
      !query || title.includes(query) || tags.includes(query);
    const itemTags = tags.split(",");
    const matchesTag =
      wanted.length === 0 ||
      (tagMode === "and"
        ? wanted.every((t) => itemTags.includes(t))
        : wanted.some((t) => itemTags.includes(t)));
    return matchesSearch && matchesTag;
  });

  // Sort
  visible.sort((a, b) => {
    const aPinned = a.getAttribute("data-pinned") === "true";
    const bPinned = b.getAttribute("data-pinned") === "true";
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;

    switch (activeSort) {
      case "date-asc":
        return (
          Number(a.getAttribute("data-date")) -
          Number(b.getAttribute("data-date"))
        );
      case "updated":
        return (
          Number(b.getAttribute("data-updated")) -
          Number(a.getAttribute("data-updated"))
        );
      case "title":
        return (a.getAttribute("data-title") || "").localeCompare(
          b.getAttribute("data-title") || "",
          "ja",
        );
      default: // date-desc
        return (
          Number(b.getAttribute("data-date")) -
          Number(a.getAttribute("data-date"))
        );
    }
  });

  // Render
  items.forEach((item) => (item.style.display = "none"));
  visible.forEach((item) => {
    item.style.display = "";
    articleList.appendChild(item);
  });

  noResults.style.display = visible.length === 0 ? "" : "none";
  if (resultCount) resultCount.textContent = `${visible.length}件の記事`;
}

restoreFromUrl();
renderTagUI();
filterAndSort();

export {};
