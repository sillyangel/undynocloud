define([
    'amd/logger/logger', 'js/globals', 'amd/cabra/helper/browserEvents',
    'amd/sandbox', 'amd/cabra/helper/blocking.events'
], function(
    Logger, _globals, browserEvents,
    Sandbox, blockingEvents
) {
    var sandbox = new Sandbox().init();
    var AppBlock = function () {
        var appBlock = this;
        this.kAppBlockingIdentifierKey = "identifier";
        this.kAppBlockingNameKey = "name";

        this._whiteListApplications = [];
        this._globalAllowedApplications = [];
        this._userDefinedAllowedApplications = [];
        this._blackListApplications = [];
        this._installedExtensions = [];

        this._subscribed = false;
        // NOTE: Subscription bindings created after method definitions.

        /**
         * Subscribe to the various chrome events.
         */
        this.subscribe = function() {
            if (this._subscribed) { return; }

            this._subscribed = true;
            browserEvents.register();
            browserEvents.on(browserEvents.EXTENSIONACTIVE, this._onExtensionActive);
            browserEvents.on(browserEvents.EXTENSIONINACTIVE, this._onExtensionInactive);
            browserEvents.on(browserEvents.EXTENSIONINSTALLED, this._onExtensionInstalledEvent);
            browserEvents.on(browserEvents.EXTENSIONUNINSTALLED, this._onExtensionUninstalledEvent);
        };

        /**
         * Unsubscribe from the various chrome events.
         */
        this.unsubscribe = function() {
            if (!this._subscribed) { return; }

            this._subscribed = false;
            browserEvents.unregister();
            browserEvents.off(browserEvents.EXTENSIONACTIVE, this._onExtensionActive);
            browserEvents.off(browserEvents.EXTENSIONINACTIVE, this._onExtensionInactive);
            browserEvents.off(browserEvents.EXTENSIONINSTALLED, this._onExtensionInstalledEvent);
            browserEvents.off(browserEvents.EXTENSIONUNINSTALLED, this._onExtensionUninstalledEvent);
        };

        this._addGlobalWhiteListRuleFromArray = function (array) {
            var self = this;
            if (array && array.length) {
                array.forEach(function (application) {
                    self._whiteListApplications.push(application);
                    self._globalAllowedApplications.push(application);
                });
            }
        };

        this._addUserWhiteListRuleFromArray = function (array) {
            var self = this;
            if (array && array.length) {
                array.forEach(function (application) {
                    self._whiteListApplications.push(application);
                    self._userDefinedAllowedApplications.push(application);
                });
            }
        };

        this._addBlackListRuleFromArray = function (array) {
            var self = this;
            if (array && array.length) {
                array.forEach(function (application) {
                    self._blackListApplications.push(application);
                });
            }
        };

        this.isWhitelist = function () {
            return this._userDefinedAllowedApplications.length > 0;
        };

        this.isBlacklist = function () {
            return !this.isWhitelist() && this._blackListApplications.length > 0;
        };

        this.isAllowAll = function () {
            return !this.isWhitelist() && !this.isBlacklist();
        };

        /**
         * Apply a new application filtering rule.
         * @param {array} coreWhitelist The core applications to whitelist.
         * @param {array} globalWhitelist Applications that are globally whitelisted.
         * @param {array} whitelist The applications to whitelist.
         * @param {array} blacklist The applications to blacklist.
         */
        this.applicationRule = function(coreWhitelist, globalWhitelist, whitelist, blacklist) {
            var self = this;
            self._whiteListApplications.splice(0, self._whiteListApplications.length);
            self._globalAllowedApplications.splice(0, self._globalAllowedApplications.length);
            self._userDefinedAllowedApplications.splice(0, self._userDefinedAllowedApplications.length);
            self._blackListApplications.splice(0, self._blackListApplications.length);

            self._addGlobalWhiteListRuleFromArray(coreWhitelist.concat(globalWhitelist));
            self._addUserWhiteListRuleFromArray(whitelist);
            self._addBlackListRuleFromArray(blacklist);

            if (self.isWhitelist() || self.isBlacklist()) {
                Logger.info("applyWithFlag:", (self.isWhitelist()) ? 'APPBLOCKING:WHITELIST' : 'APPBLOCKING:BLACKLIST');

                this.subscribe();

                chrome.management.getAll(function (extensions) {
                    Logger.debug("Extensions list", extensions);
                    if (!self._installedExtensions.length){
                        Logger.debug("Setting restore list");
                        self._installedExtensions  = extensions;
                    }
                    extensions.forEach(function(extension) {
                        if (self.shouldHideApplication(extension.name, extension.id)) {
                            if (extension.enabled) {
                                self.hideApplication(extension.name, extension.id);
                            }
                        } else if (!extension.enabled){
                            //check if we should restore it
                            for(var i=0;i<self._installedExtensions.length; i++){
                                var curr = self._installedExtensions[i];
                                if (curr.id === extension.id){
                                    if (curr.enabled){
                                        self.showApplication(extension.name, extension.id);
                                    }
                                    break;
                                }
                            }
                        }
                    });
                });
            } else if (self.isAllowAll()) {
                Logger.info("applyWithFlag:APPBLOCKING:ALLOW");

                this.unsubscribe();

                Logger.info("Will Revert Extensions Enabled State", self._installedExtensions);
                self._installedExtensions.forEach(function(extension) {
                    //if the extension was enabled when blocking started renable it
                    if (extension.enabled) {
                        self.showApplication(extension.name, extension.id);
                    } else {
                        Logger.warn("Extension was disabled when we started to keep it that way", extension);
                    }
                });
                self._installedExtensions = [];
            } else {
                Logger.error("Invalid Blocking Type");
            }
        };

        this.shouldHideApplicationMatchingProperty = function (match, propertyKey) {
            var self = this,
                predicate = function (evaluatedObject) {
                    return evaluatedObject[propertyKey].search(new RegExp(match, "i")) != -1;
                };

            if (self.isWhitelist()) {
                if(self._whiteListApplications.filter(predicate).length === 0) {
                    return true;
                }
            } else if(self.isBlacklist()) {
                if (self._globalAllowedApplications.filter(predicate).length > 0) {
                    //Even in a BlackList the Globally Allowed Apps should be allowed
                } else {
                    return (self._whiteListApplications.filter(predicate).length === 0) &&
                           (self._blackListApplications.filter(predicate).length > 0);
                }
            }
            Logger.debug("shouldHideApplicationMatchingProperty was false, App: " + match + " must be on the whitelist or not on the blacklist");
            Logger.debug("Property to match on", propertyKey);
            Logger.debug("APPBLOCKING:WHITELIST", self._whiteListApplications);
            Logger.debug("APPBLOCKING:BLACKLIST", self._blackListApplications);
            return false;
        };

        this.shouldHideApplicationWithIdentifier = function (identifier) {
            return this.shouldHideApplicationMatchingProperty(identifier, this.kAppBlockingIdentifierKey);
        };

        this.shouldHideApplicationWithName = function (name) {
            return this.shouldHideApplicationMatchingProperty(name, this.kAppBlockingNameKey);
        };

        this.shouldHideApplication = function (name, identifier) {
            return (!!identifier && this.shouldHideApplicationWithIdentifier(identifier) === this.isBlacklist()) ? this.isBlacklist() : this.shouldHideApplicationWithName(name);
        };

        this.hideApplication = function (name, identifier) {
            Logger.info("hideApplication->", (this.isWhitelist()) ? 'APPBLOCKING:WHITELIST' : 'APPBLOCKING:BLACKLIST');
            Logger.info("App " + name + "(" + identifier + ")");
            sandbox.publish(blockingEvents.block_app, {
                name: name,
                identifier: identifier
            });
            chrome.management.setEnabled(identifier, false, function () {
                Logger.info("App " + name + "(" + identifier + ") was disabled");
            });
        };

        this.showApplication = function (name, identifier) {
            Logger.info("showApplication->", (this.isWhitelist()) ? 'APPBLOCKING:WHITELIST' : 'APPBLOCKING:BLACKLIST');
            Logger.info("App " + name + "(" + identifier + ")");
            chrome.management.setEnabled(identifier, true, function () {
                Logger.info("App " + name + "(" + identifier + ") was enabled");
            });
        };

        // Application Listener Events

        this._onExtensionInstalledEvent = function(extension) {
            appBlock._installedExtensions.push(extension);
        };

        this._onExtensionUninstalledEvent = function(id) {
            var existing = appBlock._installedExtensions.filter(function(item) {
                return item.id == id;
            })[0];
            if(!!existing) {
                var index = appBlock._installedExtensions.indexOf(existing);
                appBlock._installedExtensions.splice(index, 1);
            }
            Logger.info("handleExensionUninstalledEvent->",(appBlock.isWhitelist()) ? 'APPBLOCKING:WHITELIST' : 'APPBLOCKING:BLACKLIST');
            Logger.info("Extension " + id);
        };

        this._onExtensionActive = function(extension) {
            if (appBlock.shouldHideApplication(extension.name, extension.id)) {
                Logger.info("handleExensionEnabledEvent->",(appBlock.isWhitelist()) ? 'APPBLOCKING:WHITELIST' : 'APPBLOCKING:BLACKLIST');
                Logger.info("Extension " + extension.name + "(" + extension.id + ")");
                appBlock.hideApplication(extension.name, extension.id);
            }
        };

        this._onExtensionInactive = function(extension) {
            if (appBlock.shouldHideApplication(extension.name, extension.id)) {
                Logger.info("handleExensionDisabledEvent->",(appBlock.isWhitelist()) ? 'APPBLOCKING:WHITELIST' : 'APPBLOCKING:BLACKLIST');
                Logger.info("Extension " + extension.name + "(" + extension.id + ")");
            }
        };

        // End application Listener Events

    };

    return AppBlock;
});