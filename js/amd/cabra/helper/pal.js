define([
    'amd/logger/logger', 'amd/lib/EventEmitter',  'js/globals',
    'amd/cabra/helper/browserEvents', 'amd/cabra/helper/needToExclude'
], function(
       Logger, EventEmitter, _globals,
       browserEvents, needToExclude
){
    var Pal = function () {

        var _this = this,
            lastActivity = false,
            getActivity = function(name, identifier, url, title){
                return {
                    "name": (name) ? name : "", //Display Name of the App
                    "identifier": (identifier) ? identifier : "", //Internal Name of the App
                    "url": (url) ? url : "", //Full URL of the Website if in Browser
                    "title": (title) ? title : "" //Title of the Website or Window Title of App
                };
            },
            getLockedActivity = function (title) {
                return {
                    identifier: "com.dyknow.attention",
                    name : "Locked Message",
                    title : title ? title : "Attention!"
                };
            },
            hasActivityChanged = function(activity) {
                if (!lastActivity ||
                    (lastActivity.name !== activity.name || lastActivity.identifier !== activity.identifier ||
                    lastActivity.url !== activity.url || lastActivity.title !== activity.title)) {
                    return true;
                }
                return false;
            },
            changeActivity = function(activity) {
                _this.emitEvent("activity", [activity]);
                lastActivity = activity;
            },
            ACTIVITY = {
                NAME : {
                    UNKNOWN : "unknown",
                    BROWSER : "Chrome",
                    SELF: "Dyknow"
                },
                IDENTIFIER : {
                    UNKNOWN : "unknown",
                    BROWSER : "Chrome",
                    SELF: "kmpjlilnemjciohjckjadmgmicoldglf"
                }
            },
            intervalId = false;

        this.start = function () {
            browserEvents.register();
            browserEvents.on(browserEvents.ACTIVETABCHANGED, this._onActivetabChange);
            browserEvents.on(browserEvents.EXTENSIONACTIVE, this._onExtensionActive);
            browserEvents.on(browserEvents.EXTENSIONINACTIVE, this._onExtensionInactive);
            browserEvents.on(browserEvents.FAILACTIVEWINDOW, this._onFailActiveWindow);
        };

        this.stop = function () {
            browserEvents.unregister();
            browserEvents.off(browserEvents.ACTIVETABCHANGED, this._onActivetabChange);
            browserEvents.off(browserEvents.EXTENSIONACTIVE, this._onExtensionActive);
            browserEvents.off(browserEvents.EXTENSIONINACTIVE, this._onExtensionInactive);
            browserEvents.off(browserEvents.FAILACTIVEWINDOW, this._onFailActiveWindow);
        };

        this._onExtensionActive = function(extension) {
            var activity = getActivity(extension.name, extension.id);
            if (hasActivityChanged(activity)) {
                Logger.info("Extension changed", extension);
            }
        };

        this._onExtensionInactive = function(extension) {
            //Logger.info("Extension Disabled", extension);
        };

        this._onFailActiveWindow = function(app) {
            var activity = getActivity(ACTIVITY.NAME.UNKNOWN, ACTIVITY.IDENTIFIER.UNKNOWN);
            if (hasActivityChanged(activity)) {
                Logger.info("Application Changed");
                changeActivity(activity);
            }
        };

        this._onActivetabChange = function(tab) {
            if (tab.active) {
                _this._processTabChangedEvent(tab);                
            }
        };
        
        this._urlIsSelf = function (url) {
            if (!url) { return false;}
            return url.indexOf("chrome-extension://" + ACTIVITY.IDENTIFIER.SELF) === 0;
        };

        this._urlIsAttention = function (url) {
            if (!url) { return false;}
            return this._urlIsSelf(url) && url.endsWith("/attentionRequest.html");
        };

        this._processTabChangedEvent = function(tab) {
            var ignore = false;
            var activity;
            var url = tab && tab.url || tab && tab.pendingUrl;
            if (!tab) {
                ignore = true;
            } else if (this._urlIsAttention(url)){
                activity = getLockedActivity(tab.title);
            } else if (this._urlIsSelf(url) || needToExclude(url)){
                ignore = true;
            }

            if (ignore){
                Logger.debug("Navigation Changed but is ignored", tab);
                return false;
            } else if (!activity){ //shouldnt ignore, not already generated, lets do things the old fashioned way
                activity = getActivity(ACTIVITY.NAME.BROWSER,ACTIVITY.IDENTIFIER.BROWSER, url, tab.title);
                if (tab.id){
                    activity.tab_id = tab.id;
                }
            }
            
            if (hasActivityChanged(activity)) {
                Logger.info("Navigation Changed", tab);
                changeActivity(activity);
            }
        };

        this._onBlockUrl = function (info) {

        };

        this._onBlockApp = function (info){

        };
    };

    extend( Pal, EventEmitter );

    return Pal;
});