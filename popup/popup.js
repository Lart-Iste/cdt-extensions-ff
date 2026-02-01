const hasBrowserApi = typeof browser !== "undefined";
const storage = hasBrowserApi ? browser.storage.local : chrome.storage.local;

const {
    DEFAULT_SETTINGS,
    STRATEGY_LABELS,
    normalizeStrategies,
    normalizePosition,
    clampThreshold
} = globalThis.CdtSettings;

function storageGet(defaults) {
    if (hasBrowserApi) {
        return storage.get(defaults);
    }
    return new Promise(resolve => storage.get(defaults, resolve));
}

function storageSet(values) {
    if (hasBrowserApi) {
        return storage.set(values);
    }
    return new Promise(resolve => storage.set(values, resolve));
}

document.addEventListener("DOMContentLoaded", async () => {
    const redirectToggle = document.getElementById("redirectToggle");
    const downloadToggle = document.getElementById("downloadToggle");
    const debugToggle = document.getElementById("debugToggle");
    const thresholdRange = document.getElementById("thresholdRange");
    const thresholdValue = document.getElementById("thresholdValue");
    const strategyList = document.getElementById("strategyList");
    const resetDefaults = document.getElementById("resetDefaults");
    const resetPositions = document.getElementById("resetPositions");
    const settingsToggleGlobal = document.getElementById("settingsToggleGlobal");
    const settingsToggleNexus = document.getElementById("settingsToggleNexus");
    const settingsToggleMo2 = document.getElementById("settingsToggleMo2");
    const settingsPanelGlobal = document.getElementById("settingsPanelGlobal");
    const settingsPanelNexus = document.getElementById("settingsPanelNexus");
    const settingsPanelMo2 = document.getElementById("settingsPanelMo2");
    const status = document.getElementById("status");

    const saved = await storageGet(DEFAULT_SETTINGS);
    const state = {
        redirect: saved.redirect ?? DEFAULT_SETTINGS.redirect,
        download: saved.download ?? DEFAULT_SETTINGS.download,
        debug: saved.debug ?? DEFAULT_SETTINGS.debug,
        levenshteinThreshold: clampThreshold(saved.levenshteinThreshold),
        strategies: normalizeStrategies(saved.strategies),
        positionNexus: normalizePosition(saved.positionNexus),
        positionMo2: normalizePosition(saved.positionMo2)
    };

    let statusTimer = null;
    let draggingItem = null;

    function setStatus(message) {
        status.textContent = message;
        if (statusTimer) {
            clearTimeout(statusTimer);
        }
        statusTimer = setTimeout(() => {
            status.textContent = "";
        }, 1500);
    }

    async function saveState() {
        await storageSet({
            redirect: state.redirect,
            download: state.download,
            debug: state.debug,
            levenshteinThreshold: state.levenshteinThreshold,
            strategies: state.strategies,
            positionNexus: state.positionNexus,
            positionMo2: state.positionMo2
        });
        setStatus("Paramètres sauvegardés");
    }

    function updateThresholdDisplay() {
        thresholdValue.textContent = state.levenshteinThreshold.toFixed(2);
    }

    function buildStrategyList() {
        strategyList.innerHTML = "";
        state.strategies.forEach(strategy => {
            const item = document.createElement("li");
            item.className = "strategy-item";
            item.draggable = true;
            item.dataset.strategy = strategy;

            const label = document.createElement("span");
            label.textContent = STRATEGY_LABELS[strategy] || strategy;

            const handle = document.createElement("span");
            handle.className = "drag-handle";
            handle.textContent = "⋮⋮";

            item.append(label, handle);

            item.addEventListener("dragstart", event => {
                draggingItem = item;
                item.classList.add("dragging");
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", strategy);
            });

            item.addEventListener("dragend", () => {
                if (draggingItem) {
                    draggingItem.classList.remove("dragging");
                    draggingItem = null;
                }
                saveStrategiesFromDom();
            });

            strategyList.appendChild(item);
        });
    }

    function saveStrategiesFromDom() {
        state.strategies = Array.from(strategyList.querySelectorAll(".strategy-item"))
            .map(item => item.dataset.strategy);
        saveState();
    }

    function updateUI() {
        redirectToggle.checked = state.redirect;
        downloadToggle.checked = state.download;
        debugToggle.checked = state.debug;
        thresholdRange.value = state.levenshteinThreshold.toFixed(2);
        updateThresholdDisplay();
        buildStrategyList();
    }

    strategyList.addEventListener("dragover", event => {
        event.preventDefault();
        const target = event.target.closest(".strategy-item");
        if (!target || target === draggingItem) {
            return;
        }
        const rect = target.getBoundingClientRect();
        const shouldInsertAfter = (event.clientY - rect.top) > rect.height / 2;
        strategyList.insertBefore(draggingItem, shouldInsertAfter ? target.nextSibling : target);
    });

    redirectToggle.addEventListener("change", async () => {
        state.redirect = redirectToggle.checked;
        await saveState();
    });

    downloadToggle.addEventListener("change", async () => {
        state.download = downloadToggle.checked;
        await saveState();
    });

    debugToggle.addEventListener("change", async () => {
        state.debug = debugToggle.checked;
        await saveState();
    });

    thresholdRange.addEventListener("input", () => {
        state.levenshteinThreshold = clampThreshold(thresholdRange.value);
        updateThresholdDisplay();
    });

    thresholdRange.addEventListener("change", async () => {
        state.levenshteinThreshold = clampThreshold(thresholdRange.value);
        await saveState();
    });

    function togglePanel(toggleButton, panel) {
        if (!toggleButton || !panel) {
            return;
        }
        const isExpanded = toggleButton.getAttribute("aria-expanded") === "true";
        const nextState = String(!isExpanded);
        toggleButton.setAttribute("aria-expanded", nextState);
        panel.hidden = isExpanded;
    }

    settingsToggleGlobal.addEventListener("click", () => togglePanel(settingsToggleGlobal, settingsPanelGlobal));
    settingsToggleNexus.addEventListener("click", () => togglePanel(settingsToggleNexus, settingsPanelNexus));
    settingsToggleMo2.addEventListener("click", () => togglePanel(settingsToggleMo2, settingsPanelMo2));

    resetDefaults.addEventListener("click", async () => {
        Object.assign(state, {
            levenshteinThreshold: DEFAULT_SETTINGS.levenshteinThreshold,
            strategies: [...DEFAULT_SETTINGS.strategies]
        });
        updateUI();
        await saveState();
    });

    resetPositions.addEventListener("click", async () => {
        state.positionNexus = normalizePosition(DEFAULT_SETTINGS.positionNexus);
        state.positionMo2 = normalizePosition(DEFAULT_SETTINGS.positionMo2);
        await saveState();
    });

    updateUI();
});
