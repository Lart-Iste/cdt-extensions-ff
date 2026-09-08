const hasBrowserApi = typeof browser !== 'undefined';
const extensionApi = hasBrowserApi ? browser : chrome;

const DEFAULT_TIMEOUT_MS = 10000;
const ALLOWED_HOST_SUFFIXES = [
    '.confrerie-des-traducteurs.fr',
    '.confrerie-des-traducteurs.com'
];

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') {
        return undefined;
    }

    if (message.type === 'cdt:postFormViaTab') {
        handlePostFormViaTab(message, sendResponse);
        return true; // On garde la connexion ouverte car c'est une fonction async
    }

    if (message.type === 'cdt:resolveDownload') {
        handleResolveDownload(message, sendResponse);
        return true;
    }

    if (message.type === 'cdt:openTab') {
        handleOpenTab(message, sendResponse);
        return true;
    }

    if (message.type === 'cdt:closeTab') {
        handleCloseTab(message, sender, sendResponse);
        return true;
    }

    return undefined;
});

async function handlePostFormViaTab(message, sendResponse) {
    const timeoutMs = Number.isFinite(message.timeoutMs) ? message.timeoutMs : DEFAULT_TIMEOUT_MS;

    try {
        if (!message.url) {
            throw new Error('Missing URL');
        }

        const requestUrl = new URL(message.url);
        if (!isAllowedHost(requestUrl.host)) {
            throw new Error('Blocked host');
        }

        const referrer = resolveReferrer(message.referrer);
        const tabId = await createHiddenTab(referrer);

        try {
            await waitForTabComplete(tabId, timeoutMs);
            const response = await runSearchInTab(tabId, requestUrl.toString(), String(message.body ?? ''), timeoutMs);
            sendResponse(response);
        } finally {
            await removeTab(tabId);
        }
    } catch (error) {
        sendResponse({ok: false, error: error?.message ?? 'Request failed'});
    }
}

function resolveReferrer(referrer) {
    if (!referrer) {
        return 'https://www.confrerie-des-traducteurs.fr/';
    }
    try {
        const url = new URL(referrer);
        if (isAllowedHost(url.host)) {
            return url.toString();
        }
        return 'https://www.confrerie-des-traducteurs.fr/';
    } catch (error) {
        return 'https://www.confrerie-des-traducteurs.fr/';
    }
}

function isAllowedHost(host) {
    if (!host) {
        return false;
    }
    if (host === 'www.confrerie-des-traducteurs.fr') {
        return true;
    }
    return ALLOWED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix));
}

async function handleResolveDownload(message, sendResponse) {
    try {
        if (!message?.url) {
            throw new Error('Missing URL');
        }

        const requestUrl = new URL(message.url);
        if (!isAllowedHost(requestUrl.host)) {
            throw new Error('Blocked host');
        }

        const response = await fetchWithFallback(requestUrl.toString());
        if (!response) {
            sendResponse({ok: false, error: 'Unable to resolve'});
            return;
        }

        sendResponse({
            ok: true,
            finalUrl: response.finalUrl,
            contentDisposition: response.contentDisposition
        });
    } catch (error) {
        sendResponse({ok: false, error: error?.message ?? 'Resolve failed'});
    }
}

async function fetchWithFallback(url) {
    try {
        let response = await fetch(url, {
            method: 'HEAD',
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'follow'
        });

        if (!response.ok) {
            response = await fetch(url, {
                method: 'GET',
                headers: {
                    Range: 'bytes=0-0'
                },
                credentials: 'omit',
                cache: 'no-store',
                redirect: 'follow'
            });
        }

        if (!response.ok) {
            return null;
        }

        return {
            finalUrl: response.url,
            contentDisposition: response.headers.get('content-disposition')
        };
    } catch (error) {
        return null;
    }
}

// Conversion en Promise pour Manifest V3
async function createHiddenTab(url) {
    try {
        const tab = await extensionApi.tabs.create({url, active: false});
        if (!tab?.id) {
            throw new Error('Failed to create tab');
        }
        return tab.id;
    } catch (error) {
        throw new Error(error.message);
    }
}

function waitForTabComplete(tabId, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('Tab load timeout'));
        }, timeoutMs);

        const onUpdated = (updatedId, info) => {
            if (updatedId === tabId && info.status === 'complete') {
                cleanup();
                resolve();
            }
        };

        const onRemoved = (removedId) => {
            if (removedId === tabId) {
                cleanup();
                reject(new Error('Tab closed before load'));
            }
        };

        function cleanup() {
            clearTimeout(timeoutId);
            extensionApi.tabs.onUpdated.removeListener(onUpdated);
            extensionApi.tabs.onRemoved.removeListener(onRemoved);
        }

        extensionApi.tabs.onUpdated.addListener(onUpdated);
        extensionApi.tabs.onRemoved.addListener(onRemoved);
    });
}

async function removeTab(tabId) {
    try {
        await extensionApi.tabs.remove(tabId);
    } catch (error) {
        // Ignore errors if the tab is already gone
    }
}

async function runSearchInTab(tabId, url, body, timeoutMs) {
    if (!extensionApi.scripting?.executeScript) {
        throw new Error('Scripting API unavailable');
    }

    const [{result}] = await extensionApi.scripting.executeScript({
        target: {tabId},
        world: 'MAIN',
        func: async (requestUrl, requestBody, requestTimeoutMs) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

            try {
                const response = await fetch(requestUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'application/json, text/javascript, */*; q=0.01'
                    },
                    body: requestBody,
                    signal: controller.signal,
                    credentials: 'same-origin',
                    cache: 'no-store'
                });

                const text = await response.text();
                return {
                    ok: response.ok,
                    status: response.status,
                    text,
                    contentType: response.headers.get('content-type'),
                    finalUrl: response.url
                };
            } catch (error) {
                const message = error?.name === 'AbortError' ? 'Request timeout' : (error?.message ?? 'Request failed');
                return {ok: false, error: message};
            } finally {
                clearTimeout(timeoutId);
            }
        },
        args: [url, body, timeoutMs]
    });

    return result;
}

async function handleOpenTab(message, sendResponse) {
    if (!message?.url) {
        sendResponse({ok: false, error: 'Missing URL'});
        return;
    }

    try {
        await extensionApi.tabs.create({url: message.url, active: true});
        sendResponse({ok: true});
    } catch (error) {
        sendResponse({ok: false, error: error.message});
    }
}

async function handleCloseTab(message, sender, sendResponse) {
    const tabId = sender?.tab?.id;
    if (!tabId) {
        sendResponse({ok: false, error: 'Tab unavailable'});
        return;
    }

    try {
        await extensionApi.tabs.remove(tabId);
        sendResponse({ok: true});
    } catch (error) {
        sendResponse({ok: false, error: error.message});
    }
}