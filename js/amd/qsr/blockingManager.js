define([
    'amd/cabra/helper/appBlock', 'amd/cabra/helper/urlFilter', 'amd/logger/logger',
    'underscore'
], function(
    AppBlock, UrlFilter, Logger,
    _
) {
    var instance = null;

    /**
     * Blocking manager constructor.
     * The blocking manager is designed to be accessed through the singleton
     * getter. It provides methods to use shared AppBlock and UrlFilter
     * instances.
     */
    function BlockingManager() {
        Logger.info('BlockingManager: construct');

        this.appBlock = new AppBlock();
        this.urlFilter = new UrlFilter();

        this.coreApplicationWhiteList = [
            {
                name: 'Dyknow Cloud',
                identifier: chrome.runtime.id
            },
            {
                name: 'Aristotle',
                identifier: "jpnfjgjikmagakmnbiicfdkofbjinnpi" //content filter extension
            },
            {
                name: 'Relay',
                identifier: "adkcpkpghahmbopkjchobieckeoaoeem" //content filter extension (Lightspeed)
            },
            {
                name: 'Securely-1',
                identifier: "ppdeajpebepbknlalnhnlebhioceijka" //content filter extension
            },
            {
                name: 'Securely-2',
                identifier: "iheobagjkfklnlikgihanlhcddjoihkg" //content filter extension
            }
        ];
        this.customerApplicationWhiteList = [];

        this.coreUrlWhiteList = ["studentontask.com"];
        this.customerUrlWhiteList = [];
    }

    /**
     * Blocking manager singleton getter.
     * @return {BlockingManager} The blocking manager singleton.
     */
    BlockingManager.instance = function() {
        if (!instance) { instance = new BlockingManager(); }
        return instance;
    };

    BlockingManager._resetForTest = function() {
        instance = null;
    };

    /**
     * Restore from a captured state.
     * @param {State} state A QSR state to restore.
     */
    BlockingManager.prototype.restoreState = function(state) {
        var blockingState = state.getNamed('blocking');
        Logger.info('BlockingManager: restoring state', blockingState);
        this.applyState(blockingState);
    };

    /**
     * Set the state for the blocking manager.
     * @param {mixed} state The state to apply. Falsy values clear the state.
     */
    BlockingManager.prototype.applyState = function(state) {
        if (state && !_.isEmpty(state)) {
            this.applyApplicationRulesFromState(state);
            this.applyUrlFilteringFromState(state);
        } else {
            Logger.info('BlockingManager: Clearing plans');
            this.applyApplicationRule([], []);
            this.applyUrlFiltering([], []);
        }
    };

    /**
     * Return an app list based on OS type.
     * @param {array} apps The applications to filter.
     * @param {string} type The OS type.
     * @param {boolean} [exclude=false] If the app should be excluded (`true`)
     *   instead of included (`false`).
     * @return {array} The filtered apps.
     */
    BlockingManager.prototype.applicationsForOsType = function(apps, type, exclude) {
        var negate = exclude === true;
        return apps.filter(function(app) {
            var includeApp = app.os.type === type;
            return negate ? !includeApp : includeApp;
        });
    };

    /**
     * Get all applications from all bundles.
     * @param {array} bundles The application bundles.
     * @return {array} The bundle apps.
     */
    BlockingManager.prototype.bundledApplications = function(bundles) {
        return Array.prototype.concat.apply([], bundles.map(function(bundle) {
            return bundle.applications || [];
        }));
    };

    /**
     * Get all applications from the bundles.
     * @param {array} bundles The application bundles.
     * @return {array} The bundle apps.
     */
    BlockingManager.prototype.applicationsFromBundles = function(bundles) {
        var bundlesExcludingWeb = this.applicationsForOsType(
            this.bundledApplications(bundles), 'web', true);
        var bundlesExcludingWebAndFragment = this.applicationsForOsType(
            bundlesExcludingWeb, 'web-fragment', true);

        return bundlesExcludingWebAndFragment.map(function(app) {
            return {name: app.name, identifier: app.identifier};
        });
    };

    /**
     * Get all websites from the bundles.
     * @param {array} bundles The application bundles.
     * @return {array} The bundle websites.
     */
    BlockingManager.prototype.websitesFromBundles = function(bundles) {
        var apps = this.bundledApplications(bundles);

        var web = this.applicationsForOsType(apps, 'web');
        var fragment = this.applicationsForOsType(apps, 'web-fragment');
        var chrome = this.applicationsForOsType(apps, 'chrome');
        
        var allWeb = web.concat(fragment);
        return allWeb.concat(chrome).map(function(app) {
            return {identifier: app.identifier, ostype: app.os.type};
        });
    };

    /**
     * Apply application rules from a state.
     * @param {object} state The state to apply.
     */
    BlockingManager.prototype.applyApplicationRulesFromState = function(state) {
        var whitelist = [];
        var blacklist = [];
        if (state.payload && Object.keys(state.payload).length) {
            var rule = state.payload;
            if (rule.type === 'whitelist') {
                Logger.info('BlockingManager: Received Whitelist AppRule');
                whitelist = this.applicationsFromBundles(rule.bundles);
            } else if (rule.type === 'blacklist') {
                Logger.info('BlockingManager: Received Blacklist AppRule');
                blacklist = this.applicationsFromBundles(rule.bundles);
            } else {
                Logger.error('BlockingManager: Unsupported Rule Type, to be safe we will apply a clear all rule', rule.type);
            }
        } else {
            Logger.debug('BlockingManager: Payload was ommited or did not include any keys, we will assume the desired behavior is to clear blocking');
        }
        this.applyApplicationRule(whitelist, blacklist);
    };

    /**
     * Apply URL filtering from a state.
     * @param {object} state The state to apply.
     */
    BlockingManager.prototype.applyUrlFilteringFromState = function(state) {
        var whitelist = [];
        var blacklist = [];
        if (state.payload && Object.keys(state.payload).length > 0) {
            var rule = state.payload;
            if (rule.type === 'whitelist') {
                Logger.info('BlockingManager: Received Whitelist WebsiteRule');
                whitelist = this.websitesFromBundles(rule.bundles);
            } else if (rule.type === 'blacklist') {
                Logger.info('BlockingManager: Received Blacklist WebsiteRule');
                blacklist = this.websitesFromBundles(rule.bundles);
            } else {
                Logger.error('BlockingManager: Unsupported Rule Type, to be safe we will apply a clear all rule', rule.type);
            }
        } else {
            Logger.debug('BlockingManager: Payload was ommited or did not include any keys, we will assume the desired behavior is to clear blocking');
        }
        this.applyUrlFiltering(whitelist, blacklist);
    };

    /**
     * Apply application blocking rules.
     * @param {array} whitelist Applications to whitelist.
     * @param {array} blacklist Applications to blacklist.
     */
    BlockingManager.prototype.applyApplicationRule = function(whitelist, blacklist) {
        this.appBlock.applicationRule(
            this.coreApplicationWhiteList,
            this.customerApplicationWhiteList,
            whitelist,
            blacklist
        );
    };

    /**
     * Apply URL filtering rules.
     * @param {array} whitelist Websites to whitelist.
     * @param {array} blacklist Websites to blacklist.
     */
    BlockingManager.prototype.applyUrlFiltering = function(whitelist, blacklist) {
        this.urlFilter.filter(
            this.coreUrlWhiteList,
            this.customerUrlWhiteList,
            whitelist,
            blacklist
        );
    };

    return BlockingManager;
});