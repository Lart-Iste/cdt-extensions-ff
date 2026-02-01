(function () {
    'use strict';

    if (document.getElementById('cdt-font-face')) {
        return;
    }

    const hasBrowserApi = typeof browser !== 'undefined';
    const extensionApi = hasBrowserApi ? browser : chrome;
    const fontUrl = extensionApi.runtime.getURL('fonts/Poppins-Regular.ttf');

    const style = document.createElement('style');
    style.id = 'cdt-font-face';
    style.textContent = `
        @font-face {
            font-family: "CdT Poppins";
            src: url("${fontUrl}") format("truetype");
            font-weight: 400;
            font-style: normal;
            font-display: swap;
        }
    `;

    (document.head || document.documentElement).appendChild(style);
})();