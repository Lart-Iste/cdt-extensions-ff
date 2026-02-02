(function () {
    'use strict';

    const hasBrowserApi = typeof browser !== 'undefined';
    const extensionApi = hasBrowserApi ? browser : chrome;
    const storage = extensionApi.storage.local;

    const {
        DEFAULT_SETTINGS,
        STRATEGY_ORDER,
        WIDGET_THEME,
        normalizePosition,
        normalizeStrategies,
        clampThreshold
    } = globalThis.CdtSettings;

    const ASSETS = {
        templateUrl: extensionApi.runtime.getURL('templates/nexusToCdt.html'),
        iconUrl: extensionApi.runtime.getURL('images/logo_128.png')
    };

    const UI_STATES = {
        default: {label: 'Traduction<br>française', disabled: false},
        loading: {label: 'Recherche...', disabled: true},
        success: {label: 'Traduction<br>trouvée', disabled: false},
        notFound: {label: 'Pas de traduction<br>trouvée', disabled: false},
        error: {label: 'Erreur', disabled: false}
    };

    // Configuration & Constants
    const CONFIG = {
        debug: DEFAULT_SETTINGS.debug,
        search: {
            levenshteinThreshold: DEFAULT_SETTINGS.levenshteinThreshold,
            strategies: [...STRATEGY_ORDER],
            authorSeparators: ['-', ',', ' and ', '&', '+']
        },
        ui: {
            position: normalizePosition(DEFAULT_SETTINGS.positionNexus),
            colors: {
                default: WIDGET_THEME.primary,
                success: WIDGET_THEME.success,
                warning: WIDGET_THEME.warning,
                error: WIDGET_THEME.error,
                text: WIDGET_THEME.text,
                border: WIDGET_THEME.border
            }
        },
        selectors: {
            modTitle: "#pagetitle > h1, .modpage-title h1, h1[itemprop='name']",
            uploader: "#fileinfo a[href*='/users/'], .file-uploader a, a[rel='author']"
        },
        endpoints: {
            'skyrim': "https://www.confrerie-des-traducteurs.fr/skyrim/api/recherche/simple",
            'skyrimspecialedition': "https://www.confrerie-des-traducteurs.fr/skyrim/api/recherche/simple",
            'oblivion': "https://www.confrerie-des-traducteurs.fr/oblivion/api/recherche/simple",
            'morrowind': "https://www.confrerie-des-traducteurs.fr/morrowind/api/recherche/simple",
            'fallout4': "https://www.confrerie-des-traducteurs.fr/fallout4/api/recherche/simple",
            'newvegas': "https://www.confrerie-des-traducteurs.fr/fallout-new-vegas/api/recherche/simple",
            'fallout3': "https://www.confrerie-des-traducteurs.fr/fallout3/api/recherche/simple"
        }
    };

    const Widget = globalThis.CdtWidget;

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

    function sendMessage(message) {
        if (hasBrowserApi) {
            return extensionApi.runtime.sendMessage(message);
        }
        return new Promise((resolve, reject) => {
            extensionApi.runtime.sendMessage(message, response => {
                const error = extensionApi.runtime.lastError;
                if (error) {
                    reject(error);
                    return;
                }
                resolve(response);
            });
        });
    }

    async function openTab(url) {
        const response = await sendMessage({type: 'cdt:openTab', url});
        if (!response?.ok) {
            throw new Error(response?.error || 'Failed to open tab');
        }
    }

    // Core Services Layer
    const Logger = globalThis.CdtLogger.createLogger('[Nexus-CdT]', () => CONFIG.debug);

    class StringUtils {
        static normalize(str) {
            return str.toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\s]/g, '')
                .trim();
        }

        static levenshteinDistance(a, b) {
            const matrix = Array.from({length: b.length + 1}, (_, i) => [i]);
            for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

            for (let i = 1; i <= b.length; i++) {
                for (let j = 1; j <= a.length; j++) {
                    matrix[i][j] = b[i - 1] === a[j - 1]
                        ? matrix[i - 1][j - 1]
                        : Math.min(
                            matrix[i - 1][j - 1] + 1,
                            matrix[i][j - 1] + 1,
                            matrix[i - 1][j] + 1
                        );
                }
            }

            return matrix[b.length][a.length];
        }

        static calculateSimilarity(str1, str2) {
            const normalized1 = this.normalize(str1);
            const normalized2 = this.normalize(str2);
            const distance = this.levenshteinDistance(normalized1, normalized2);
            return distance / Math.max(normalized1.length, normalized2.length);
        }
    }

    class HTTPClient {
        static makeRequest(url, params, referrer) {
            const query = params.toString();
            Logger.info('Sending search request', {url, query, referrer});
            return sendMessage({
                type: 'cdt:postFormViaTab',
                method: 'POST',
                url,
                body: query,
                referrer,
                timeoutMs: 10000
            });
        }
    }

    class SearchResultsParser {
        static parse(payload) {
            const trimmed = (payload ?? '').trim();
            if (!trimmed) {
                return {mods: [], source: 'empty'};
            }

            const jsonMods = this.#tryParseJson(trimmed);
            if (jsonMods) {
                return {mods: jsonMods, source: 'json'};
            }

            if (CONFIG.debug) {
                Logger.info('HTML response sample', {
                    sample: trimmed.slice(0, 200)
                });
            }

            return {mods: [], source: 'html'};
        }

        static #tryParseJson(payload) {
            try {
                if (!payload.startsWith('{') && !payload.startsWith('[')) {
                    return null;
                }
                const data = JSON.parse(payload);
                const entries = data?.Entries ?? [];
                return entries.map(entry => ({
                    name: entry.OriginalName || entry.Name,
                    link: entry.Link
                }));
            } catch (error) {
                return null;
            }
        }
    }

    // Data Access Layer
    class ModInfoExtractor {
        static extract() {
            const modTitle = this.#extractElement(CONFIG.selectors.modTitle);
            const uploader = this.#extractElement(CONFIG.selectors.uploader);
            const authors = this.#extractAuthors();

            const info = {modTitle, uploader, authors};
            Logger.info('Extracted mod information', info);

            if (!modTitle && !uploader && !authors.length) {
                Logger.warn('No mod information found - selectors may be outdated');
            }

            return info;
        }

        static #extractElement(selector) {
            const selectors = selector.split(',').map(s => s.trim());

            for (const sel of selectors) {
                const element = document.querySelector(sel);
                if (element?.innerText?.trim()) {
                    return element.innerText.trim();
                }
            }

            return null;
        }

        static #extractAuthors() {
            const sideItems = document.querySelectorAll('.sideitem');

            for (const item of sideItems) {
                const h3 = item.querySelector('h3');
                const headerText = h3?.textContent.trim().toLowerCase();

                if (headerText === 'created by' || headerText === 'author' || headerText === 'authors') {
                    return this.#parseAuthorsText(
                        item.textContent.replace(h3.textContent, '').trim()
                    );
                }
            }

            return [];
        }

        static #parseAuthorsText(authorsText) {
            return CONFIG.search.authorSeparators
                .reduce((acc, separator) => acc.flatMap(author => author.split(separator)), [authorsText])
                .map(author => author.trim())
                .filter(author => author.length > 0);
        }
    }

    class GameConfigResolver {
        static resolve(gameCategory) {
            const endpoint = CONFIG.endpoints[gameCategory] || CONFIG.endpoints['skyrim'];
            const gameParams = this.#getGameSpecificParams(gameCategory);

            return {endpoint, gameParams};
        }

        static #getGameSpecificParams(gameCategory) {
            if (!gameCategory) {
                return {};
            }
            if (gameCategory.includes('skyrimspecialedition')) {
                return {skyrim: 0, skyrimSE: 1};
            }
            if (gameCategory.includes('skyrim')) {
                return {skyrim: 1, skyrimSE: 0};
            }
            return {};
        }
    }

    // Business Logic Layer
    class SearchStrategy {
        constructor(searchService) {
            this.searchService = searchService;
        }

        async execute(modInfo) {
            throw new Error('Strategy must implement execute method');
        }
    }

    class AuthorsSearchStrategy extends SearchStrategy {
        async execute(modInfo) {
            if (!modInfo.authors?.length) return null;

            for (const author of modInfo.authors) {
                const result = await this.searchService.searchByCreator(author, 'author');
                if (result) return result;
            }

            return null;
        }
    }

    class UploaderSearchStrategy extends SearchStrategy {
        async execute(modInfo) {
            if (!modInfo.uploader) return null;
            return await this.searchService.searchByCreator(modInfo.uploader, 'uploader');
        }
    }

    class TitleSearchStrategy extends SearchStrategy {
        async execute(modInfo) {
            if (!modInfo.modTitle) return null;
            return await this.searchService.searchByTitle(modInfo.modTitle);
        }
    }

    class TranslationSearchService {
        constructor(gameConfig) {
            this.gameConfig = gameConfig;
            this.strategies = this.#createStrategies();
            this.currentModInfo = null;
        }

        #createStrategies() {
            return {
                authors: new AuthorsSearchStrategy(this),
                uploader: new UploaderSearchStrategy(this),
                title: new TitleSearchStrategy(this)
            };
        }

        async search(modInfo) {
            this.currentModInfo = modInfo;
            Logger.info('Starting translation search', {strategies: CONFIG.search.strategies});

            for (const strategyName of CONFIG.search.strategies) {
                const strategy = this.strategies[strategyName];
                if (!strategy) continue;

                try {
                    const result = await strategy.execute(modInfo);
                    if (result) {
                        Logger.success(`Found match using ${strategyName} strategy`, result);
                        return result;
                    }
                } catch (error) {
                    Logger.error(`${strategyName} strategy failed`, error);
                }
            }

            return null;
        }

        async searchByCreator(creator, type) {
            const params = new URLSearchParams({
                search: 'basic',
                term: creator.replace(/\s+/g, '_'),
                name: 0,
                nameVO: 0,
                description: 0,
                authors: 1,
                translators: 1,
                testers: 0,
                proofreaders: 0,
                designers: 0,
                actors: 0,
                vostfr: 0,
                vf: 0,
                vfPart: 0,
                excludeIsNotProofread: 0,
                ...this.gameConfig.gameParams
            });
            const referrer = `${this.gameConfig.endpoint.replace('/api/recherche/simple', '/recherche')}?${params.toString()}`;

            const response = await HTTPClient.makeRequest(this.gameConfig.endpoint, params, referrer);
            if (!response?.ok) {
                const details = response?.error || `Request failed (${response?.status ?? 'unknown'})`;
                throw new Error(details);
            }
            Logger.info('Search response metadata', {
                status: response.status,
                contentType: response.contentType,
                finalUrl: response.finalUrl
            });

            const {mods, source} = SearchResultsParser.parse(response.text);

            Logger.info(`${type} search results`, {modsFound: mods.length, source});
            return this.#findBestMatch(mods);
        }

        async searchByTitle(title) {
            const params = new URLSearchParams({
                search: 'basic',
                term: title.replace(/\s+/g, '_'),
                name: 1,
                nameVO: 1,
                description: 0,
                authors: 0,
                translators: 1,
                testers: 0,
                proofreaders: 0,
                designers: 0,
                actors: 0,
                vostfr: 0,
                vf: 0,
                vfPart: 0,
                excludeIsNotProofread: 0,
                ...this.gameConfig.gameParams
            });
            const referrer = `${this.gameConfig.endpoint.replace('/api/recherche/simple', '/recherche')}?${params.toString()}`;

            const response = await HTTPClient.makeRequest(this.gameConfig.endpoint, params, referrer);
            if (!response?.ok) {
                const details = response?.error || `Request failed (${response?.status ?? 'unknown'})`;
                throw new Error(details);
            }
            Logger.info('Search response metadata', {
                status: response.status,
                contentType: response.contentType,
                finalUrl: response.finalUrl
            });

            const {mods, source} = SearchResultsParser.parse(response.text);

            Logger.info('Title search results', {modsFound: mods.length, source});
            return this.#findBestMatch(mods);
        }

        #findBestMatch(mods) {
            if (!mods.length) return null;
            if (!this.currentModInfo?.modTitle) return mods[0];

            let bestMatch = mods[0];
            let bestSimilarity = Infinity;

            for (const mod of mods) {
                const similarity = StringUtils.calculateSimilarity(this.currentModInfo.modTitle, mod.name);

                Logger.info('Comparing titles', {
                    original: this.currentModInfo.modTitle,
                    candidate: mod.name,
                    similarity: similarity.toFixed(3)
                });

                if (similarity < bestSimilarity) {
                    bestSimilarity = similarity;
                    bestMatch = mod;
                }
            }

            if (bestSimilarity <= CONFIG.search.levenshteinThreshold) {
                Logger.success('Found good match', {similarity: bestSimilarity.toFixed(3)});
                return bestMatch;
            }

            Logger.warn('No match under threshold', {
                similarity: bestSimilarity.toFixed(3),
                threshold: CONFIG.search.levenshteinThreshold
            });
            return null;
        }
    }

    // View Layer
    class TemplateLoader {
        static async load() {
            const response = await fetch(ASSETS.templateUrl);
            if (!response.ok) {
                throw new Error('Failed to load template');
            }

            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const container = doc.querySelector('.cdt-widget--nexus');

            if (!container) {
                throw new Error('Template missing root container');
            }

            return document.importNode(container, true);
        }

        static createFallback() {
            const container = document.createElement('div');
            container.id = 'cdt-nexus-root';
            container.className = 'cdt-widget cdt-widget--nexus';
            container.dataset.state = 'default';
            container.innerHTML = `
                <div class="cdt-widget__drag" title="Déplacer" aria-hidden="true">⋮⋮</div>
                <button class="cdt-widget__button" type="button">
                    <img class="cdt-widget__icon" alt="Confrérie des Traducteurs">
                    <span class="cdt-widget__label">Traduction<br>française</span>
                </button>
            `;
            return container;
        }
    }

    class UIManager {
        constructor(container) {
            this.container = container;
        }

        static async create() {
            const existing = document.querySelector('.cdt-widget--nexus');
            if (existing) {
                return new UIManager(existing);
            }

            try {
                const container = await TemplateLoader.load();
                return new UIManager(container);
            } catch (error) {
                Logger.warn('Template load failed, using fallback', error);
                return new UIManager(TemplateLoader.createFallback());
            }
        }

        applyTheme(uiConfig) {
            const bottom = typeof uiConfig.position.bottom === 'number'
                ? `${uiConfig.position.bottom}px`
                : uiConfig.position.bottom;
            const right = typeof uiConfig.position.right === 'number'
                ? `${uiConfig.position.right}px`
                : uiConfig.position.right;

            this.container.style.setProperty('--cdt-bottom', bottom);
            this.container.style.setProperty('--cdt-right', right);
            this.container.style.setProperty('--cdt-widget-bg', uiConfig.colors.default);
            this.container.style.setProperty('--cdt-widget-success', uiConfig.colors.success);
            this.container.style.setProperty('--cdt-widget-warning', uiConfig.colors.warning);
            this.container.style.setProperty('--cdt-widget-error', uiConfig.colors.error);
            this.container.style.setProperty('--cdt-widget-text', uiConfig.colors.text);
            this.container.style.setProperty('--cdt-widget-border', uiConfig.colors.border);
        }

        mount() {
            if (!this.container.isConnected) {
                document.body.appendChild(this.container);
            }
        }
    }

    class ButtonComponent {
        constructor(container, onClick) {
            this.container = container;
            this.button = container.querySelector('.cdt-widget__button');
            this.label = container.querySelector('.cdt-widget__label');
            this.icon = container.querySelector('.cdt-widget__icon');
            this.onClick = onClick;

            if (!this.button || !this.label || !this.icon) {
                throw new Error('Button template is incomplete');
            }

            this.button.addEventListener('click', () => this.#handleClick());
        }

        initialize(iconUrl) {
            this.icon.src = iconUrl;
            this.setState('default');
        }

        setState(stateName) {
            const state = UI_STATES[stateName] || UI_STATES.default;
            this.container.dataset.state = stateName;
            this.button.disabled = state.disabled;
            this.label.innerHTML = state.label;
        }

        async #handleClick() {
            if (this.button.disabled) return;
            if (this.container.dataset.cdtDragging === 'true') {
                return;
            }
            await this.onClick();
        }
    }

    // Application Controller
    class TranslationFinderApp {
        constructor() {
            this.gameCategory = window.location.pathname.split('/')[1];
            this.gameConfig = GameConfigResolver.resolve(this.gameCategory);
            this.searchService = new TranslationSearchService(this.gameConfig);
            this.uiManager = null;
            this.button = null;
            this.dragCleanup = null;
        }

        async initialize() {
            Logger.info('Initializing Translation Finder', {gameCategory: this.gameCategory});

            this.uiManager = await UIManager.create();
            this.uiManager.applyTheme(CONFIG.ui);

            this.button = new ButtonComponent(this.uiManager.container, () => this.#handleSearch());
            this.button.initialize(ASSETS.iconUrl);
            this.uiManager.mount();

            if (Widget?.enableWidgetDrag) {
                this.dragCleanup = Widget.enableWidgetDrag(this.uiManager.container, {
                    handleSelector: '.cdt-widget__drag',
                    onDragEnd: position => this.#savePosition(position)
                });
            }

            Logger.success('Application initialized successfully');
        }

        async #handleSearch() {
            try {
                this.button.setState('loading');

                const modInfo = ModInfoExtractor.extract();

                if (!modInfo.modTitle && !modInfo.uploader && !modInfo.authors.length) {
                    throw new Error('Unable to extract mod information');
                }

                const result = await this.searchService.search(modInfo);

                if (result) {
                    this.#openTranslationPage(result);
                    this.button.setState('success');
                    setTimeout(() => this.button.setState('default'), 3000);
                } else {
                    this.button.setState('notFound');
                    setTimeout(() => this.button.setState('default'), 3000);
                }

            } catch (error) {
                Logger.error('Search operation failed', error);
                this.button.setState('error');
                setTimeout(() => this.button.setState('default'), 3000);
            }
        }

        #openTranslationPage(result) {
            const url = result.link?.startsWith('http')
                ? result.link
                : `https://www.confrerie-des-traducteurs.fr${result.link}`;
            Logger.success('Opening translation page', {url});
            openTab(url).catch(error => {
                Logger.error('Failed to open tab via background, falling back', error);
                window.open(url, '_blank');
            });
        }

        async #savePosition(position) {
            CONFIG.ui.position = normalizePosition(position);
            await storageSet({positionNexus: CONFIG.ui.position});
        }
    }

    // Application Entry Point
    async function bootstrap() {
        const settings = await storageGet(DEFAULT_SETTINGS);
        CONFIG.debug = settings.debug;
        CONFIG.search.levenshteinThreshold = clampThreshold(settings.levenshteinThreshold);
        CONFIG.search.strategies = normalizeStrategies(settings.strategies);
        CONFIG.ui.position = normalizePosition(settings.positionNexus);

        if (!settings.redirect) {
            return;
        }

        const start = async () => {
            const app = new TranslationFinderApp();
            await app.initialize();

            extensionApi.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local') {
                    return;
                }
                if (changes.debug) {
                    CONFIG.debug = Boolean(changes.debug.newValue);
                }
                if (changes.positionNexus) {
                    CONFIG.ui.position = normalizePosition(changes.positionNexus.newValue);
                    app.uiManager?.applyTheme(CONFIG.ui);
                }
                if (changes.levenshteinThreshold) {
                    CONFIG.search.levenshteinThreshold = clampThreshold(changes.levenshteinThreshold.newValue);
                }
                if (changes.strategies) {
                    CONFIG.search.strategies = normalizeStrategies(changes.strategies.newValue);
                }
            });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                start().catch(error => Logger.error('Initialization failed', error));
            }, {once: true});
        } else {
            await start();
        }
    }

    bootstrap().catch(error => {
        console.error('[Nexus-CdT] 🔴 Initialization failed', error);
    });
})();
