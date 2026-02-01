(function () {
    'use strict';

    const DEFAULT_POSITION = {bottom: 20, right: 20};

    const DEFAULT_SETTINGS = {
        redirect: false,
        download: false,
        debug: false,
        levenshteinThreshold: 0.3,
        strategies: ['authors', 'uploader', 'title'],
        positionNexus: {...DEFAULT_POSITION},
        positionMo2: {...DEFAULT_POSITION}
    };

    const STRATEGY_ORDER = ['authors', 'uploader', 'title'];

    const STRATEGY_LABELS = {
        authors: 'Auteurs',
        uploader: 'Uploader',
        title: 'Titre'
    };

    const WIDGET_THEME = {
        primary: '#b4975a',
        text: '#1a1a1a',
        border: '#8a6f3b',
        success: '#5cb85c',
        warning: '#f0ad4e',
        error: '#d9534f'
    };

    function normalizeStrategies(strategies) {
        if (!Array.isArray(strategies)) {
            return [...STRATEGY_ORDER];
        }

        const allowed = new Set(STRATEGY_ORDER);
        const normalized = strategies.filter(strategy => allowed.has(strategy));
        return normalized.length ? normalized : [...STRATEGY_ORDER];
    }

    function normalizePosition(position) {
        if (!position || typeof position !== 'object') {
            return {...DEFAULT_POSITION};
        }

        const bottom = Number(position.bottom);
        const right = Number(position.right);

        return {
            bottom: Number.isFinite(bottom) ? Math.max(0, bottom) : DEFAULT_POSITION.bottom,
            right: Number.isFinite(right) ? Math.max(0, right) : DEFAULT_POSITION.right
        };
    }

    function clampThreshold(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return DEFAULT_SETTINGS.levenshteinThreshold;
        }
        return Math.min(0.8, Math.max(0.1, numeric));
    }

    globalThis.CdtSettings = {
        DEFAULT_SETTINGS,
        STRATEGY_ORDER,
        STRATEGY_LABELS,
        WIDGET_THEME,
        DEFAULT_POSITION,
        normalizeStrategies,
        normalizePosition,
        clampThreshold
    };
})();
