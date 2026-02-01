(function () {
    'use strict';

    function createLogger(prefix, getDebug) {
        const emoji = {info: '📘', warn: '⚠️', error: '🔴', success: '✅'};
        const logger = {
            info: (message, data) => log('info', message, data),
            warn: (message, data) => log('warn', message, data),
            error: (message, data) => log('error', message, data),
            success: (message, data) => log('success', message, data)
        };

        function log(level, message, data) {
            if (typeof getDebug === 'function' && !getDebug()) {
                return;
            }
            const output = `${prefix} ${emoji[level]} ${message}`;
            if (level === 'warn') {
                console.warn(output, data ?? '');
                return;
            }
            if (level === 'error') {
                console.error(output, data ?? '');
                return;
            }
            console.log(output, data ?? '');
        }

        return logger;
    }

    globalThis.CdtLogger = {
        createLogger
    };
})();
