define([
    'amd/logger/logger', 'amd/lib/EventEmitter',  'js/globals',
    'amd/cabra/helper/safeChromeCommand'
], function(
       Logger, EventEmitter, _globals,
       safeChrome
){
    var BrowserEvents = function () {
        var browserEvents = this;
        browserEvents.ACTIVETABCHANGED = "activeTabChanges";
        browserEvents.TABCHANGE = "tabChange";
        browserEvents.EXTENSIONACTIVE = "extensionActive";
        browserEvents.EXTENSIONINACTIVE = "extensionInactive";
        browserEvents.FAILACTIVEWINDOW = "failActiveWindow";
        browserEvents.EXTENSIONINSTALLED = "extensionInstalled";//appblock maintains a list of installed extensions 
        browserEvents.EXTENSIONUNINSTALLED = "extensionUninstalled";
        browserEvents._refCounter = 0;
        browserEvents._subscribed = false;
        browserEvents.register = function () {
            if (browserEvents._refCounter < 0){
                Logger.error("browserEvents- register had to reset counter");
                browserEvents._refCounter = 0;
            }
            if (browserEvents._refCounter === 0){
                browserEvents.subscribe();
            }
            browserEvents._refCounter++;
        };

        browserEvents.unregister = function () {
            browserEvents._refCounter--;
            if (browserEvents._refCounter < 0){
                Logger.error("browserEvents- unregistered past all");
                browserEvents._refCounter = 0;
            }
            if (browserEvents._refCounter === 0){
                browserEvents.unsubscribe();
            }
        };

        browserEvents.subscribe = function() {
            Logger.info("Subscribing to browser events");
            if (browserEvents._subscribed) { return; }
            browserEvents._subscribed = true;

            chrome.management.onInstalled.addListener(browserEvents._onExtensionInstalledEvent);
            chrome.management.onUninstalled.addListener(browserEvents._onExtensionRemovedEvent);
            chrome.management.onEnabled.addListener(browserEvents._onExtensionEnabledEvent);
            chrome.management.onDisabled.addListener(browserEvents._onExtensionDisabledEvent);
            chrome.tabs.onCreated.addListener(browserEvents._onTabAddedEvent);
            chrome.tabs.onRemoved.addListener(browserEvents._onTabRemovedEvent);
            chrome.webNavigation.onCommitted.addListener(browserEvents._onTabWillNavigateEvent, {urls: ["<all_urls>"]});
            chrome.webNavigation.onCompleted.addListener(browserEvents._onTabDidNavigateEvent, {urls: ["<all_urls>"]});
            chrome.windows.onRemoved.addListener(browserEvents._onWindowRemovedEvent);

            browserEvents._periodicCheckInterval = setInterval(browserEvents._processPeriodicCheck, 1000);
        };

        browserEvents.unsubscribe = function () {
            Logger.info("Unsubscribing from browser events");
            browserEvents._subscribed = false;
            chrome.management.onInstalled.removeListener(browserEvents._onExtensionInstalledEvent);
            chrome.management.onUninstalled.removeListener(browserEvents._onExtensionRemovedEvent);
            chrome.management.onEnabled.removeListener(browserEvents._onExtensionEnabledEvent);
            chrome.management.onDisabled.removeListener(browserEvents._onExtensionDisabledEvent);
            chrome.tabs.onCreated.removeListener(browserEvents._onTabAddedEvent);
            chrome.tabs.onRemoved.removeListener(browserEvents._onTabRemovedEvent);
            chrome.webNavigation.onCommitted.removeListener(browserEvents._onTabWillNavigateEvent);
            chrome.webNavigation.onCompleted.removeListener(browserEvents._onTabDidNavigateEvent);
            chrome.windows.onRemoved.removeListener(browserEvents._onWindowRemovedEvent);
            clearInterval(browserEvents._periodicCheckInterval);
        };

        // Application Listener Events

        browserEvents._onExtensionInstalledEvent = function(extension) {
            browserEvents.emitEvent(browserEvents.EXTENSIONINSTALLED, [extension]);
            browserEvents.emitEvent(browserEvents.EXTENSIONACTIVE, [extension]);
        };

        browserEvents._onExtensionRemovedEvent = function(id) {
            Logger.debug("ExtensionUninstalled: " + id);
            browserEvents.emitEvent(browserEvents.EXTENSIONUNINSTALLED, [id]);
        };

        browserEvents._onExtensionEnabledEvent = function(extension) {
            browserEvents.emitEvent(browserEvents.EXTENSIONACTIVE, [extension]);
        };

        browserEvents._onExtensionRemovedEvent = function(extension) {
            browserEvents.emitEvent(browserEvents.EXTENSIONINACTIVE, [extension]);
        };

        // End application Listener Events

        // Browsers Listener Events
        browserEvents._onTabAddedEvent = function (tab) {
            //no normalization needed. these events have tab.id
            browserEvents.emitTabChange(tab);
        };

        browserEvents._onTabRemovedEvent = function (tabId) {
            Logger.debug("TabRemoved: " + tabId);
        };

        browserEvents._onWindowRemovedEvent = function(windowId){
            if (browserEvents.lastGoodWindow === windowId){
                //reset tracking vars
                browserEvents.lastGoodWindow = null;
                browserEvents.lastWasOutofBrowser = false;
                //call check whcih is equipped to have fallback
                browserEvents._processPeriodicCheck();
            }
        };

        browserEvents._onTabWillNavigateEvent = function(details) {
            if (details.tabId === -1 || details.frameId !== 0) {
                Logger.warn("Invalid TabID or FrameID");
                return;
            }

            //these callback objects are not Tab objects
            //must get the Tab object to satisfy assumptions elsewhere in the code (eg: tab.active)
            safeChrome.tabs.get(details.tabId, function (tab) {
                if (tab) {
                    browserEvents.emitTabChange(tab);
                }
            });
        };

        browserEvents.tabIsUsAndShouldBeIgnored = function (tab){
            return tab && [
                "chrome-extension://kmpjlilnemjciohjckjadmgmicoldglf/ui/views/cabras/messagesRequest.html",
                "chrome-extension://kmpjlilnemjciohjckjadmgmicoldglf/ui/views/cabras/pollRequest.html",
                "chrome-extension://kmpjlilnemjciohjckjadmgmicoldglf/ui/views/cabras/statusRequest.html"
            ].some(function (url){
                return (tab.url && tab.url.indexOf(url) === 0) ||
                    (tab.pendingUrl && tab.pendingUrl.indexOf(url) === 0);
            });
        };

        browserEvents.tabIsLockedMessage = function (tab){
            return tab && [
                "chrome-extension://kmpjlilnemjciohjckjadmgmicoldglf/ui/views/cabras/attentionRequest.html"
            ].some(function (url){
                return (tab.url && tab.url.indexOf(url) === 0) ||
                    (tab.pendingUrl && tab.pendingUrl.indexOf(url) === 0);
            });
        };

        browserEvents._onTabDidNavigateEvent = function(details) {
            if (details.tabId === -1 || details.frameId !== 0) {
                Logger.warn("Invalid TabID or FrameID");
                return;
            }
            //these callback objects are not Tab objects
            //must get the Tab object to satisfy assumptions elsewhere in the code (eg: tab.active)
            safeChrome.tabs.get(details.tabId, function (tab) {
                if (tab) {
                    browserEvents.emitTabChange(tab);
                }
            });
        };

        //we need to track lastGoodWindow so we can ignore our windows. these should not 
        //be considered part of tab change events and should actively be ignored
        browserEvents.lastGoodWindow = null;
        browserEvents.lastWasOutofBrowser = false;
        browserEvents.emitTabChange = function (tab, onlyTabNotActiveTab){
            if(tab && tab.windowId &&
                (
                    //currently something that's not from our extension
                    (tab.url && tab.url.indexOf("chrome-extension://kmpjlilnemjciohjckjadmgmicoldglf") != 0) ||
                        (tab.pendingUrl && tab.pendingUrl.indexOf("chrome-extension://kmpjlilnemjciohjckjadmgmicoldglf") != 0)
                )
            ){
                browserEvents.lastGoodWindow = tab.windowId;
                browserEvents.lastWasOutofBrowser = false;
            } else if (browserEvents.tabIsUsAndShouldBeIgnored(tab)){
                //need to ignore this event instead of send it out
                return;
            }

            browserEvents.emitEvent(browserEvents.ACTIVETABCHANGED, [tab]);
            browserEvents.emitEvent(browserEvents.TABCHANGE, [tab]);
        };

        browserEvents.emitFailedActiveWindow = function(err){
            browserEvents.lastWasOutofBrowser = true;
            browserEvents.emitEvent(browserEvents.FAILACTIVEWINDOW, [err]);
        };

        // End browsers Listener Events

        browserEvents._processPeriodicCheck = function() {
            browserEvents._getActiveWindow()
                .done(function(window) {
                    var tab = browserEvents._getActiveTab(window);
                    if (tab) {
                        browserEvents.emitTabChange(tab);
                    } else {
                        Logger.warn("Failed to get active tab");
                    }
                })
                .fail(function(err) {
                    Logger.warn("Failed to get active window");
                    if (err) {
                        Logger.error(err.message, err.stack);
                    }
                    browserEvents.emitFailedActiveWindow(err);
                });
        };

        //this happens regularly and i dont want them to get
        //backed up so I dont think we should use safechrome here
        browserEvents._getActiveWindow = function() {
            return $.Deferred(function(dfd) {
                try {
                    chrome.windows.getLastFocused({ populate: true }, function (window) {
                        //if there is no window or the last focused window is no longer focused, we know a packaged app is focused.
                        if (!window || !window.focused) {
                            dfd.reject(null);
                        } else if (window.tabs && window.tabs.length === 1 && browserEvents.tabIsUsAndShouldBeIgnored(window.tabs[0])){
                            if (browserEvents.lastWasOutofBrowser){
                                dfd.reject(null);
                            } else if (!browserEvents.lastGoodWindow){
                                //go look up fallback 
                                try{
                                    chrome.windows.getLastFocused({ populate: true, windowTypes: ["normal"]}, function (backupWindow){
                                        if (chrome.runtime.lastError && chrome.runtime.lastError.message) {
                                            Logger.error("browserEvents: fallback lookup failed " + JSON.stringify(chrome.runtime.lastError));
                                            dfd.reject(null);
                                        } else if (!backupWindow) {//note, we expect it to not be focused. our app window is focused
                                            dfd.reject(null);
                                        } else {
                                            dfd.resolve(backupWindow);
                                        }
                                    });
                                }catch(innerErr){
                                    //note, documentation implies that the filter
                                    //was updated in chrome 88 but we've successfully 
                                    //using chrome 72, but just to be sure we'll wrap 
                                    //this as unknown params throw right away
                                    Logger.error("browserEvents: fallback failed " + innerErr.toString());
                                    dfd.reject(null);
                                }
                            } else {
                                chrome.windows.get(browserEvents.lastGoodWindow, { populate: true}, function(lastGoodWindow){
                                    if (chrome.runtime.lastError && chrome.runtime.lastError.message) {
                                        Logger.error("browserEvents: fallback failed " + JSON.stringify(chrome.runtime.lastError));
                                        browserEvents.lastGoodWindow = null;//since that errored, clear out
                                        dfd.reject(null);//todo, figure out the proper fallback that doesnt loop forever
                                    } else {
                                        dfd.resolve(window);
                                    }
                                });
                            }
                        } else {
                            dfd.resolve(window);
                        }
                    });
                } catch(e){
                    dfd.reject(e);
                }
            });
        };

        browserEvents._getActiveTab = function(window) {
            if (window.tabs) {
                return window.tabs.filter(function(item) {
                    if (item.active) {
                        return item;
                    }
                })[0];
            }
        };

        browserEvents._resetForTest = function (){
            browserEvents._subscribed = false;
            browserEvents._refCounter = 0;
            browserEvents.removeAllListeners();
            browserEvents.lastGoodWindow = null;
            browserEvents.lastWasOutofBrowser = false;
        };
    };


    extend( BrowserEvents, EventEmitter );
    //create an instance we'll be using as a singleton
    return new BrowserEvents();
});