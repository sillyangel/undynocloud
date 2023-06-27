define([
    'amd/sandbox', 'amd/logger/logger', 'amd/helpers',
    'underscore'
], function(
    Sandbox, Logger, WindowHelper,
    _
) {
    var sandbox = new Sandbox().init();
    var windowHelper = new WindowHelper();

    var keepAlive = function (openPromise, shouldBeOpenPromise, condition, resolution) {
        this.windowHelper = windowHelper;
        this.windowId = false;
        this.handlingOpen = false;
        this._open = openPromise;
        this._shouldBeOpen = shouldBeOpenPromise;

        this._subscribed = false;
        // NOTE: Subscription binding created after method definitions.

        this._processWindowRemovedEvent = function (windowId) {
            Logger.debug("Window was Removed", windowId);
            if (windowId == -1) {
                Logger.warn("Unknown windowId, will ignore");
                return;
            }
            if (this.windowId == windowId) {
                Logger.warn("Watched window was removed");
                this.windowId = false;
            }
        };

        this.checkCondition = function () {
            var checkConditionFunctionName = (condition) ? condition : "isFocused";
            return this[checkConditionFunctionName]();
        };

        this.resolution = function () {
            var resolutionFunctionName = (resolution) ? resolution : "focus";
            return this[resolutionFunctionName]();
        };

        this.focus = function() {
            var self = this;
            return new Promise(function (resolve, reject) {
                self.close().then(function() {
                    Logger.info("windowKeepAlive", "focus called. Will call open");
                    return self.open().then(resolve, reject);
                }, reject);
            });
        };

        this.shouldKeepAlive = function () {
            var self = this;
            return new Promise(function (resolve, reject) {
                self._shouldBeOpen().then(function() {
                    Logger.info("Window should be kept alive");
                    resolve();
                }, function () {
                    Logger.warn("Window can die");
                    reject();
                });
            });
        };

        this.isFullscreenAndFocused = function () {
            var self = this;
            return new Promise(function (resolve, reject) {
                self.isFocused().then(function() {
                    return self.isFullscreen().then(resolve, reject);
                }, reject);
            });
        };

        this.isFullscreen = function () {
            var self = this;
            return new Promise(function (resolve, reject) {
                if (self.windowId) {
                    self.windowHelper.getWindow(self.windowId).then(function(window) {
                        if (window.state === "fullscreen") {
                            resolve();
                        } else {
                            reject();
                        }
                    }, function () {
                        reject();
                    });
                } else {
                    reject();
                }
            });
        };

        this.isFocused = function () {
            var self = this;
            return new Promise(function (resolve, reject) {
                if (self.windowId) {
                    self.windowHelper.getWindow(self.windowId).then(function(window) {
                        if (window.focused) {
                            resolve();
                        } else {
                            reject();
                        }
                    }, function () {
                        reject();
                    });
                } else {
                    reject();
                }
            });
        };

        this.isOpened = function () {
            var self = this;
            return new Promise(function (resolve, reject) {
                if (self.windowId) {
                    self.windowHelper.isWindowOpen(self.windowId).then(function() {
                        Logger.debug("Window is Open");
                        resolve();
                    }, function () {
                        Logger.warn("Window is Closed");
                        reject();
                    });
                } else {
                    reject();
                }
            });
        };

        this.open = function () {
            var self = this;
            return new Promise(function (resolve, reject) {
                Logger.debug("Open New Window: " + self.handlingOpen);
                if (!self.windowId && !self.handlingOpen) {
                    Logger.debug("will open window");
                    self.handlingOpen = true;
                    self._open().then(function (window) {
                        Logger.info("Window was opened successfully", window);
                        self.windowId = window.id;
                        self.handlingOpen = false;
                        resolve(window);
                    }, function (err) {
                        Logger.warn("Window failed to open", err);
                        self.handlingOpen = false;
                        reject("open is undefined");
                    });
                } else {
                    Logger.warn("windowId already exists or already opening");
                    reject("windowId already exists or is opening");
                }
            });
        };

        this.close = function () {
            var self = this;
            return new Promise(function (resolve, reject) {
                Logger.debug("Close Existing Window");
                if (self.windowId) {
                    self.isOpened().then(function() {
                        Logger.warn("Window Should be closed but is open, closing...");
                        return self.windowHelper.closeWindow(self.windowId).then(function () {
                            Logger.debug("Window was closed successfully");
                            var id = self.windowId;
                            self.windowId = false;
                            resolve(id);
                        }, function () {
                            Logger.warn("Window failed to close");
                            reject("Window failed to close");
                        });
                    }, function () {
                        Logger.debug("Window Should be closed and is, doing nothing");
                        var id = self.windowId;
                        self.windowId = false;
                        resolve(id);
                    });
                } else {
                    Logger.warn("windowId is undefined");
                    var id = self.windowId;
                    self.windowId = false;
                    resolve(id);
                }
            });
        };

        // Bind the event listener used for chrome events.
        this._onWindowRemovedEvent = this._processWindowRemovedEvent.bind(this);

        /**
         * Subscribe to the various chrome events.
         */
        this.subscribe = function() {
            if (this._subscribed) { return; }
            this._subscribed = true;
            chrome.windows.onRemoved.addListener(this._onWindowRemovedEvent);
        };

        /**
         * Unsubscribe from the various chrome events.
         */
        this.unsubscribe = function() {
            if (!this._subscribed) { return; }
            chrome.windows.onRemoved.removeListener(this._onWindowRemovedEvent);
            this._subscribed = false;
        };
    };

    keepAlive.windowHelper = windowHelper;

    /**
     * Open window promise builder.
     *
     * @param {string} what
     *   What is being requested to open. This is used for logging and the
     *   event name when the window has been opened.
     * @param {object} request
     *   The request that was made to open the window. This will be used with
     *   `what` for the sandbox event when the window is opened.
     * @param {function} openMethod
     *   The method to call to open the window. This method should take `args`
     *   individually and a callback for when opened, or failed. It is assumed
     *   that this method may set `chrome.runtime.lastError`.
     * @param {mixed} context What `openMethod` should be called against.
     * @param {array} args The arguments to pass to `openMethod`.
     *
     * @return {Promise} A promise for opening the window.
     */
    keepAlive.openPromise = function(what, request, openMethod, context, args) {
        return new Promise(function(resolve, reject) {
            var failed = false;
            var openArgs = (args || []).slice();
            openArgs.push(function(opened) {
                if (chrome.runtime.lastError) {
                    failed = true;
                    var message = what + ' window errored while opening';
                    Logger.warn(message, chrome.runtime.lastError);
                    reject(message);
                    return;
                }
                Logger.info(what + ' window opened for keep alive', opened.id);
                var fastReadyTimeout = _.delay(function() {
                    failed = true;
                    var message = what + ' window was not ready fast enough';
                    sandbox.unsubscribe('dyknowWindowReady', windowReadyCallback);
                    Logger.warn(message, opened.id);
                    reject(message);
                    try {
                        chrome.windows.remove(opened.id, function() {
                            if (chrome.runtime.lastError) {
                                Logger.warn(what + ' window errored while closing', opened.id);
                            } else {
                                Logger.info(what + ' window closed successfully', opened.id);
                            }
                        });
                    } catch (e) {
                        Logger.warn(what + ' window errored while closing', e);
                    }
                }, 1500);
                var windowReadyCallback = function(windowId) {
                    if (windowId !== opened.id) { return; }
                    sandbox.unsubscribe('dyknowWindowReady', windowReadyCallback);
                    if (failed) {
                        Logger.info(what + ' window ready, but already failed', opened.id);
                        return;
                    }
                    sandbox.publish(what + 'Request', request);
                    clearTimeout(fastReadyTimeout);
                    fastReadyTimeout = null;
                    Logger.log(what + ' window was opened with window ID', opened.id);
                    resolve(opened);
                };
                sandbox.subscribe('dyknowWindowReady', windowReadyCallback);
            });
            try {
                Logger.info(what + ' window opening');
                openMethod.apply(context || null, openArgs);
            } catch(e) {
                var message = what + ' window failed to open';
                Logger.warn(message, e);
                reject(message);
            }
        });
    };

    /**
     * Popup opener helper.
     * See `keepAlive.openPromise` for more argument details.
     *
     * @param {string} what A name for what is being opened.
     * @param {object} request The request to open the window.
     * @param {string} path The path of the page to open.
     * @param {Number} width The desired window width.
     * @param {Number} height The desired window height.
     *
     * @return {Promise} A promise for opening the window.
     */
    keepAlive.openPopupPromise = function(what, request, path, width, height) {
        var args = [path, 'popup', height, width, 0, screen.width - width, true];
        return keepAlive.openPromise(what, request, windowHelper.openWindow, windowHelper, args);
    };

    /**
     * Should be open promise helper.
     * @param {function} check A function to check if the window should be open.
     * @return {Promise} A promise wrapping the check condition.
     */
    keepAlive.shouldBeOpenPromise = function(check) {
        return new Promise(function(resolve, reject) {
            if (check()) {
                resolve();
            } else {
                reject();
            }
        });
    };

    return keepAlive;
});