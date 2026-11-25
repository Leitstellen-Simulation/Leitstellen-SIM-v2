document.querySelectorAll("[data-editor-tabs]").forEach((tablist) => {
  const tabs = [...tablist.querySelectorAll("[role='tab']")];

  function activateTab(activeTab) {
    tabs.forEach((tab) => {
      const active = tab === activeTab;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
    });
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => activateTab(tab)));
  tablist.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    const next = {
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    activateTab(tabs[next]);
    tabs[next].focus();
  });
});
