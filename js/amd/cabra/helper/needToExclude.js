define([], function () {
    //this function is pulled directly from the original globals.js
    //wihtout updating to be what I actually want
    var excludeUrlPatterns = [
        'chrome-devtools://',//need to exclude these for now till we figure out how to support them
        'chrome-extension://kmpjlilnemjciohjckjadmgmicoldglf'
    ];
    /**
     *
     * @param url
     * @returns {boolean}
     */
         return function needToExclude(url) {
            var exclude = false;
            excludeUrlPatterns.forEach(function (pattern) {
                if (url.indexOf(pattern) !== -1) {
                    exclude = true;
                    return;
                }
            });
            return exclude;
        };
});