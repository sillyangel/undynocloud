define([
    'amd/logger/logger', 'js/globals', 'amd/cabra/helper/browserEvents',
    'amd/sandbox', 'amd/cabra/helper/blocking.events',  'amd/cabra/helper/needToExclude',
    'amd/cabra/helper/safeChromeCommand', "underscore"
], function(
    Logger, _globals, browserEvents,
    Sandbox, blockingEvents, needToExclude,
    safeChrome, _
) {
    var sandbox = new Sandbox().init();
    var UrlFilter = function (redirectLocation) {

        this._whiteListWebsites = [];
        this._globalAllowedWebsites = [];
        this._userDefinedAllowedWebsites = [];
        this._blackListWebsites = [];
        this._filteredTabs = {};
        this._revertedTabs = {};

        this._subscribed = false;
        // NOTE: Subscription bindings created after method definitions.
        /**
         * Subscribe to the various chrome events.
         * This will also begin the periodic check interval.
         */
        this.subscribe = function() {
            if (this._subscribed) { return; }
            this._subscribed = true;
            browserEvents.register();
            browserEvents.on(browserEvents.TABCHANGE, this._onTabChange);
        };

        /**
         * Unsubscribe from the listened events.
         * This will also end the periodic check interval.
         */
        this.unsubscribe = function() {
            if (!this._subscribed) { return; }
            browserEvents.unregister();
            browserEvents.off(browserEvents.TABCHANGE, this._onTabChange);
            this._subscribed = false;
        };

        this._addGlobalWhiteListWebsitesFromArray = function (array) {
            var self = this;
            if (array && array.length) {
                array.forEach(function (website) {
                    self._whiteListWebsites.push(website);
                    self._globalAllowedWebsites.push(website);
                });
            }
        };

        this._addUserWhiteListWebsitesFromArray = function (array) {
            var self = this;
            if (array && array.length) {
                array.forEach(function (website) {
                    self._whiteListWebsites.push(website);
                    self._userDefinedAllowedWebsites.push(website);
                });
            }
        };

        this._addBlackListWebsitesFromArray = function (array) {
            var self = this;
            if (array && array.length) {
                array.forEach(function (website) {
                    self._blackListWebsites.push(website);
                });
            }
        };


        this.redirectLocation = (!!redirectLocation) ? redirectLocation : "https://studentontask.com";

        this.isWhitelist = function () {
            return this._userDefinedAllowedWebsites.length > 0;
        };

        this.isBlacklist = function () {
            return !this.isWhitelist() && this._blackListWebsites.length > 0;
        };

        this.isAllowAll = function () {
            return !this.isWhitelist() && !this.isBlacklist();
        };

        /**
         * Apply a new set of filtering rules.
         * @param {array} coreWhitelist The core application whitelist.
         * @param {array} globalWhitelist The globally configured whitelist.
         * @param {array} whitelist A whitelist to apply.
         * @param {array} blacklist A blacklist to apply.
         */
        this.filter = function(coreWhitelist, globalWhitelist, whitelist, blacklist) {
            var self = this;
            self._whiteListWebsites.splice(0, self._whiteListWebsites.length);
            self._globalAllowedWebsites.splice(0, self._globalAllowedWebsites.length);
            self._userDefinedAllowedWebsites.splice(0, self._userDefinedAllowedWebsites.length);
            self._blackListWebsites.splice(0, self._blackListWebsites.length);

            self._addGlobalWhiteListWebsitesFromArray(
                coreWhitelist
                .concat(globalWhitelist)
                .concat([
                    new URL(self.redirectLocation).hostname,
                    {identifier: "securly.com/blocked", ostype: "web-fragment"}
                ])
            );
            self._addUserWhiteListWebsitesFromArray(whitelist);
            self._addBlackListWebsitesFromArray(blacklist);

            if (self.isWhitelist() || self.isBlacklist()) {
                Logger.info("applyWithFlag:", (self.isWhitelist()) ? 'FILTER:WHITELIST' : 'FILTER:BLACKLIST');
                self.subscribe();
                self.filterActiveTabs();
            } else if (self.isAllowAll()) {
                Logger.info("applyWithFlag:FILTER:ALLOW");
            //  we're no longer unsubscribing from events because
            //    (a) it's pointless, we won't block anything anyway because shouldFilterWebsiteWithURL will return false
            //    (b) no performance hit since Activity Monitor is watching anyway
            //    (c) we need to keep watching to sleep the tab after filter plan is released (this is the real reason)
            //  --but in any case, this is where unsub used to happen.
                this.revertFilteredTabs();
            } else {
                Logger.error("Invalid Blocking Type");
            }
        };

        /**
         * Check if a URL should be filtered.
         * @param {string} url A URL to validate.
         * @returns {boolean} If the url should be filtered.
         */
        this.shouldFilterWebsiteWithURL = function(url) {
            var self = this;

            // Guard against filtering with an allow all.
            if (self.isAllowAll()) {
                Logger.debug("Filtering should not be applied for allow all.");
                return false;
            }

            var predicate = function(evaluatedObject) {
                    try {
                        if(evaluatedObject.ostype && evaluatedObject.ostype == 'web-fragment') {
                            if (evaluatedObject.identifier.indexOf("www.google.com/search?q=") === 0){
                                //evaluate as google search fragment
                                //"www.google.com/search?q="
                                //1.extract the above query param
                                //2. create the regex
                                var andIndex = evaluatedObject.identifier.indexOf("&");
                                if (andIndex == -1){
                                    andIndex = evaluatedObject.identifier.length -1;
                                } else {
                                    andIndex -= 1;
                                }
                                var queryParam = evaluatedObject.identifier.substr(24, andIndex -23);
                                var regexObj = (queryParam).replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
                                var rex = new RegExp("([^.]\\.)*www.google.com/search\\?([^q][^=]*=[^&]*&)*q=[^&]*" + regexObj + "([^\n])*", "i");
                                return url.search(rex) !== -1;
                            }
                            //change normal web fragment


                            //escape characters in identifier
                            var regexObj = (evaluatedObject.identifier).replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");

                            //account for URLs ending in / - allows a route-terminating character (?#:/) plus more text, or end of URL
                            var last = regexObj.substr(regexObj.length - 1);
                            if(last == "/") {
                                regexObj = regexObj.substring(0, regexObj.length - 2) + "(\\/|\\?|\\#|\\:|$)";
                            }

                            return url.search(new RegExp('([^.]\.)*'+regexObj+'([^\n])*', "i")) !== -1;
                        } else {
                            if(evaluatedObject.identifier) {
                                evaluatedObject = evaluatedObject.identifier;
                            }
                            var host = new URL(url).hostname;
                            return host.search(new RegExp(evaluatedObject, "i")) !== -1;
                        }
                    }catch(ex) {
                        Logger.error("Failed to Evaluate URL");
                        Logger.debug("URL:", url);
                        Logger.debug("EvaluatedObject:", evaluatedObject);
                        return false;
                    }
                };

            if (needToExclude(url)) {
                Logger.debug("The should be excluded from filtering always", url);
                return false;
            }

            //Chrome new tab, always allow and report up
            if (url.indexOf("chrome-search://") > -1) {
                Logger.info("Chrome New Tab should be excluded from filtering");
                return false;
            }

            try
            {
                var host = new URL(url).hostname;
                if (!host) {
                    Logger.warn("The url does not have a hostname, will allow it", url);
                    return false;
                }
            } catch(ex) {
                Logger.error("Failed to Evaluate URL");
                Logger.debug("URL:", url);
                return false;
            }

            if (self.isWhitelist()) {
                if(self._whiteListWebsites.filter(predicate).length === 0) {
                    return true;
                }
            } else if(self.isBlacklist()) {
                if (self._globalAllowedWebsites.filter(predicate).length > 0) {
                    //Even in a BlackList the Globally Allowed Apps should be allowed
                } else {
                    return (self._whiteListWebsites.filter(predicate).length === 0) &&
                           (self._blackListWebsites.filter(predicate).length > 0);
                }
            }
            Logger.debug("shouldFilterWebsiteWithURL was false, URL: " + url + " must be on the whitelist or not on the blacklist");
            Logger.debug("FILTER:WHITELIST", self._whiteListWebsites);
            Logger.debug("FILTER:BLACKLIST", self._blackListWebsites);
            return false;
        };

        /**
         * Filter all the currently active tabs.
         */
        this.filterActiveTabs = function() {
            var self = this;
            safeChrome.windows.getAll({ populate: true }, function(windows) {
                var tabs = _.flatten(windows.map(function (win){
                    return win.tabs;
                })).filter(function (tab){
                    return Boolean(tab);
                });
                Logger.info("Will Filter active tabs", tabs);
                tabs.forEach(function(tab) {
                    if(self.shouldFilterWebsiteWithURL(tab.url)) {
                        self.redirectTab(tab.id, tab);
                    }
                });
            });
        };

        this.redirectTab = function(tabId, tab) {
            var self = this;
            Logger.debug("Will Redirect Tab", tabId);
            self._filteredTabs[tabId] = Object.assign({},tab);
            sandbox.publish(blockingEvents.block_url, {
                url: tab.url, 
                title: tab.title,
                tab_id: tabId
            });
            safeChrome.tabs.update(tabId, { url: self.redirectLocation });
        };

        // TAB REVERSION AND SLEEPING: AN ESSAY
            //Time for a chat. This is a weird implementation, right? Well, here's the story:
            //First, the intent of *reverting* tabs is that a student gets back to what they were doing before the blocking plan was enforced.
            //Simple enough; hence, revertFilteredTabs() and its constituent function revertTab().
            //
            //We can't use Chrome's chrome.tabs.goBack() function because the way we block URLs means the URL being blocked doesn't make it into Chrome's
            //navigation history, so goBack() usually takes the tab back to the page *before* the blocked page. 
            //
            //So instead we pack all the tabs we filter into _filteredTabs as they're being filtered, and when the blocking plan is released, we send them
            //back from StudentOnTask to the original url.
            //
            //However, there's a UX impact to just releasing all the tabs and letting them all load: all the released tabs load. This isn't a joke, per se;
            //any autoplaying media will start playing and RAM & CPU usage could suddenly skyrocket as tabs that were previously loaded individually and
            //potentially discarded (more on that later) days ago are suddenly requested and forced back into memory all at once.
            //
            //So we need to release all the tabs, but also not release all the tabs.  For this, Chrome offers us chrome.tabs.discard, which is perfect for
            //our purposes: it removes the tab from memory, stops loading the tab, but leaves it in the tab bar with its history intact.
            //
            //Hence, sleepTab() ("Discard" isn't as semantic for what we're doing, and the implementation may well change in the future, so I'm calling it
            //"sleep" instead of "discard").  But we can't call it right away in the callback for the redirect because the tab title will blank out
            //after navigation starts (thus after tab reversion), defaulting the tab title text to the bare url it's going to.  Which is bad UX; in most
            //cases that URL starts with "https://www.--", so you can't find the tab you're looking for and end up clicking them all open looking for the
            //one you're trying to get back to--meaning you end up with all your tabs active anyway.
            //
            //But we have _processTabChange firing every time a tab changes anyway; including when the title has resolved.  So if we don't unsubscribe from
            //the UrlFilter, we can continue using that to watch for these reverted tabs (the ones in the aptly named _revertedTabs hash) to load their
            //title, and sleep them then.
            //
            //So, this is the lifespan of a filtered tab:
            // 1. Student's tabs are off task.  Teacher activates blocking plan.
            // 2. Student's tabs are added to the _filteredTabs hash and redirected to studentontask.
            // 3. Teacher releases blocking plan. revertFilteredTabs() fires.
            // 4. revertTab() individually reverts each tab in _filteredTabs and puts them in _revertedTabs.  Reverted tabs begin loading.
            // 5. Once the tab has a title, _processTabChange notices and sleeps the tab with sleepTab().

        this.revertFilteredTabs = function() {
            var self = this;
            self._revertedTabs = {};
            Object.keys(self._filteredTabs).forEach(function(key){
                var filteredTab = self._filteredTabs[key];
                safeChrome.tabs.get(filteredTab.id, function(filteredTabCurrentState){
                    if(!!filteredTabCurrentState){
                        if (self.redirectLocation + "/" == filteredTabCurrentState.url && //if they've navigated away to an on-task page, we don't want to revert
                            filteredTabCurrentState.tabStatus != "loading") { //if they're currently navigating, we don't want to revert
                            self.revertTab(filteredTab, filteredTabCurrentState);
                            self._revertedTabs[filteredTab.id] = Object.assign({},filteredTab);
                        }
                    }
                    delete self._filteredTabs[key];               
                });
            });
            self._filteredTabs = {};
        };

        this.revertTab = function(filteredTab) {
            safeChrome.tabs.update(filteredTab.id,{url:filteredTab.url},function(){
                Logger.debug("Did revert tab ", filteredTab.id, " to ", filteredTab.url);});
        };

        this.sleepTab = function(tab){
            safeChrome.tabs.discard(tab.id, function(sleptTab){
                //chrome.tabs.discard is our sleep method; it removes the tab from memory, but leaves it in the tab list at the top of the browser.
                //Making it active (clicking on the tab) will give the tab a new id and reload the tab.
                if (!!sleptTab) { //Chrome will return null if it couldn't discard the tab for whatever reason
                    Logger.debug("Did sleep tab ", sleptTab.id);
                } else {
                    Logger.debug("Couldn't sleep tab ", tab.id);
                }
            });
        };

        // Browsers Listener Events

        //okay I dont really know what this is supposed to do
        this._processTabSelectionChangeEvent = function () {
            var self = this;
            Logger.debug("handleTabSelectionChangeEvent->",(this.isWhitelist()) ? 'FILTER:WHITELIST' : 'FILTER:BLACKLIST');
            self.filterActiveTabs();
        };

        this._processTabChange = function(tab) {
            if (this.shouldFilterWebsiteWithURL(tab.url)) {
                Logger.debug("handleTabChange->",(this.isWhitelist()) ? 'FILTER:WHITELIST' : 'FILTER:BLACKLIST');
                Logger.debug("Tab:" + tab.id + "(" + tab.url + ")");
                this.redirectTab(tab.id, tab);
            } else if (Object.keys(this._revertedTabs).length > 0) { 
                //We don't want all tabs to load when a blocking plan is released.  So when they start to reload, we put all the background ones to sleep.
                //when tabs are reverted, they get put into the _revertedTabs hash. The tabChange listener waits for them to begin loading and then sleeps them.
                if (this._revertedTabs[tab.id] &&
                    tab.url.toLowerCase().indexOf(this.redirectLocation.toLowerCase()) === -1 && //we don't want to sleep studentontask
                    tab.title != tab.url){ //we also want to wait for the title to load before sleeping so that the tab bar isn't just a sea of URLs
                        if (!tab.active) { //don't try to sleep the active tab
                            this.sleepTab(tab);
                        }
                        delete this._revertedTabs[tab.id];
                }
            }
        };


        // Bind the event listeners used for chrome events.
        this._onTabChange = this._processTabChange.bind(this);
    };

    return UrlFilter;
});