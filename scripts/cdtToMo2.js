(function () {
    'use strict';

    const hasBrowserApi = typeof browser !== 'undefined';
    const extensionApi = hasBrowserApi ? browser : chrome;
    const storage = extensionApi.storage.local;

    const {
        DEFAULT_SETTINGS,
        WIDGET_THEME,
        normalizePosition
    } = globalThis.CdtSettings;

    const ASSETS = {
        templateUrl: extensionApi.runtime.getURL('templates/cdtToMo2.html'),
        iconUrl: extensionApi.runtime.getURL('images/logo.png')
    };

    const CONFIG = {
        debug: DEFAULT_SETTINGS.debug,
        ui: {
            position: normalizePosition(DEFAULT_SETTINGS.positionMo2),
            colors: {
                primary: WIDGET_THEME.primary,
                text: WIDGET_THEME.text,
                border: WIDGET_THEME.border
            }
        },
        games: {
            'skyrim': {
                gameId: 'skyrimse',
                selector: "body > section > main > div > div > div > div:nth-of-type(3) > a"
            },
            'oblivion': {
                gameId: 'oblivion',
                selector: "body > section > main > section:nth-of-type(2) > div:nth-of-type(3) > a"
            },
            'morrowind': {
                gameId: 'morrowind',
                selector: "body > section > main > section:nth-of-type(2) > div:nth-of-type(3) > a"
            },
            'fallout-new-vegas': {
                gameId: 'falloutnv',
                selector: "body > section > main > section:nth-of-type(2) > div:nth-of-type(3) > a"
            },
            'fallout3': {
                gameId: 'fallout3',
                selector: "body > section > main > section:nth-of-type(2) > div:nth-of-type(3) > a"
            },
            'fallout4': {
                gameId: 'fallout4',
                selector: "body > section > main > section:nth-of-type(2) > div:nth-of-type(3) > a"
            }
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

    // Core Services Layer
    const Logger = globalThis.CdtLogger.createLogger('[CdT-MO2]', () => CONFIG.debug);

    class URLParser {
        static getCurrentGameCategory() {
            return window.location.pathname.split('/')[1];
        }

        static encodeForModManager(url) {
            return encodeURIComponent(url);
        }
    }

    // Business Logic Layer
    class GameConfigService {
        static getConfigForCategory(category) {
            const config = Object.entries(CONFIG.games)
                .find(([key]) => category.includes(key))?.[1];

            if (config) {
                Logger.info('Game configuration found', {category, config});
            } else {
                Logger.error('Unsupported game category', {category});
            }

            return config;
        }
    }

    class DownloadLinkExtractor {
        constructor(gameConfig) {
            this.gameConfig = gameConfig;
        }

        extract() {
            if (!this.gameConfig?.selector) {
                Logger.error('Invalid game configuration');
                return null;
            }

            const element = document.querySelector(this.gameConfig.selector);
            if (!element?.href) {
                Logger.warn('Download link element not found', {selector: this.gameConfig.selector});
                return null;
            }

            Logger.info('Download URL extracted', {url: element.href});
            return element.href;
        }
    }

    class DownloadUrlResolver {
        static async resolve(downloadUrl) {
            if (!downloadUrl) {
                return {url: null, fileName: null};
            }

            const response = await this.#resolveViaBackground(downloadUrl);
            if (!response?.ok) {
                Logger.warn('Failed to resolve download URL', response?.error);
                return {url: downloadUrl, fileName: null};
            }

            const fileName = this.#extractFileName(response.contentDisposition, response.finalUrl);
            const finalUrl = response.finalUrl || downloadUrl;

            if (finalUrl !== downloadUrl) {
                Logger.info('Resolved download URL', {from: downloadUrl, to: finalUrl});
            }

            return {url: finalUrl, fileName};
        }

        static async #resolveViaBackground(url) {
            return sendMessage({
                type: 'cdt:resolveDownload',
                url
            });
        }

        static #extractFileName(contentDisposition, finalUrl) {
            if (contentDisposition) {
                const filenameStar = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
                if (filenameStar?.[1]) {
                    try {
                        return decodeURIComponent(filenameStar[1]);
                    } catch (error) {
                        return filenameStar[1];
                    }
                }

                const filenameMatch = contentDisposition.match(/filename\s*=\s*\"?([^\";]+)\"?/i);
                if (filenameMatch?.[1]) {
                    return filenameMatch[1];
                }
            }

            if (finalUrl) {
                try {
                    const url = new URL(finalUrl);
                    const lastSegment = url.pathname.split('/').filter(Boolean).pop();
                    if (lastSegment && lastSegment.includes('.')) {
                        return decodeURIComponent(lastSegment);
                    }
                } catch (error) {
                    return null;
                }
            }

            return null;
        }

    }

    class ModManagerLinkGenerator {
        constructor(gameConfig) {
            this.gameConfig = gameConfig;
        }

        generate(downloadUrl) {
            if (!downloadUrl || !this.gameConfig?.gameId) {
                Logger.error('Missing required parameters for link generation');
                return null;
            }

            const encodedUrl = URLParser.encodeForModManager(downloadUrl);
            const link = `modl://${this.gameConfig.gameId}/?url=${encodedUrl}`;

            Logger.info('Generated mod manager link', {link});
            return link;
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
            const container = doc.querySelector('.cdt-widget--mo2');

            if (!container) {
                throw new Error('Template missing root container');
            }

            return document.importNode(container, true);
        }

        static createFallback() {
            const container = document.createElement('div');
            container.id = 'cdt-mo2-root';
            container.className = 'cdt-widget cdt-widget--mo2';
            container.dataset.state = 'default';
            container.innerHTML = `
                <div class="cdt-widget__drag" title="Déplacer" aria-hidden="true">⋮⋮</div>
                <button class="cdt-widget__button" type="button">
                    <img class="cdt-widget__icon" alt="Confrérie des Traducteurs">
                    <span class="cdt-widget__label">Télécharger<br>avec<br>MO2</span>
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
            const existing = document.querySelector('.cdt-widget--mo2');
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
            this.container.style.setProperty('--cdt-widget-bg', uiConfig.colors.primary);
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
        }

        setDisabled(disabled) {
            this.button.disabled = disabled;
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
    class MO2HandlerApp {
        constructor() {
            this.gameCategory = URLParser.getCurrentGameCategory();
            this.gameConfig = GameConfigService.getConfigForCategory(this.gameCategory);
            this.uiManager = null;
            this.button = null;
            this.modManagerLink = null;
            this.dragCleanup = null;
        }

        async initialize() {
            Logger.info('Initializing MO2 Handler');

            if (!this.gameConfig) {
                Logger.error('Cannot initialize without valid game configuration');
                return;
            }

            const downloadUrl = this.#extractDownloadUrl();
            if (!downloadUrl) {
                Logger.error('Failed to extract download URL');
                return;
            }

            const resolved = await DownloadUrlResolver.resolve(downloadUrl);
            const modManagerLink = this.#generateModManagerLink(resolved.url);
            if (!modManagerLink) {
                Logger.error('Failed to generate mod manager link');
                return;
            }
            this.modManagerLink = modManagerLink;

            if (resolved.fileName) {
                Logger.info('Resolved filename', {fileName: resolved.fileName});
            }

            await this.#setupUI();
            Logger.success('Application initialized successfully');
        }

        #extractDownloadUrl() {
            const extractor = new DownloadLinkExtractor(this.gameConfig);
            return extractor.extract();
        }

        #generateModManagerLink(downloadUrl) {
            const generator = new ModManagerLinkGenerator(this.gameConfig);
            return generator.generate(downloadUrl);
        }

        async #setupUI() {
            this.uiManager = await UIManager.create();
            this.uiManager.applyTheme(CONFIG.ui);
            this.button = new ButtonComponent(this.uiManager.container, () => this.#handleDownload());
            this.button.initialize(ASSETS.iconUrl);
            this.button.setDisabled(!this.modManagerLink);
            this.uiManager.mount();

            if (Widget?.enableWidgetDrag) {
                this.dragCleanup = Widget.enableWidgetDrag(this.uiManager.container, {
                    handleSelector: '.cdt-widget__drag',
                    onDragEnd: position => this.#savePosition(position)
                });
            }
        }

        #handleDownload() {
            try {
                const popup = window.open(this.modManagerLink, '_blank');
                if (popup) {
                    setTimeout(() => {
                        try {
                            popup.close();
                        } catch (error) {
                            // Ignore close failures (browser may block programmatic close).
                        }
                    }, 800);
                }
                Logger.success('Download initiated via MO2');
            } catch (error) {
                Logger.error('Failed to initiate download', error);
            }
        }

        async #savePosition(position) {
            CONFIG.ui.position = normalizePosition(position);
            await storageSet({positionMo2: CONFIG.ui.position});
        }
    }

    async function bootstrap() {
        const settings = await storageGet(DEFAULT_SETTINGS);
        CONFIG.debug = settings.debug;
        CONFIG.ui.position = normalizePosition(settings.positionMo2);

        if (!settings.download) {
            return;
        }

        const start = async () => {
            const app = new MO2HandlerApp();
            await app.initialize();

            extensionApi.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local') {
                    return;
                }
                if (changes.debug) {
                    CONFIG.debug = Boolean(changes.debug.newValue);
                }
                if (changes.positionMo2) {
                    CONFIG.ui.position = normalizePosition(changes.positionMo2.newValue);
                    app.uiManager?.applyTheme(CONFIG.ui);
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
        console.error('[CdT-MO2] 🔴 Initialization failed', error);
    });
})();
