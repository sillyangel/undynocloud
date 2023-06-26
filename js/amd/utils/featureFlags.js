define([
    'amd/logger/logger',
    'amd/settings',
    'amd/utils/featureFlags.backing',
    'underscore'
], function(
    Logger,
    SETTINGS,
    flags,
    _
) {
    /**
     * Feature flags constructor.
     */
    function FeatureFlags() {
        var self = this;

        // Create the promise for when the school information has been loaded.
        // The school resolver will be the resolve function for this promise.
        self._schoolResolver = null;
        self._schoolPromise = new Promise(function(resolve, reject) {
            self._schoolResolver = resolve;
        });

        self._loadSchool();
    }

    var instance = null;
    /**
     * Singleton getter.
     */
    FeatureFlags.instance = function() {
        if (instance === null) {
            instance = new FeatureFlags();
        }
        return instance;
    };

    /**
     * Class `isEnabled` method.
     * This will fetch the singleton and use it for the request.
     */
    FeatureFlags.isEnabled = function(key) {
        return this.instance().isEnabled(key);
    };

    /**
     * Class `setSchool` method.
     * This will fetch the singleton and use it for the request.
     */
    FeatureFlags.setSchool = function(school) {
        return this.instance().setSchool(school);
    };

    /**
     * Helper to load school information for feature flag support.
     * @return {Promise} A promise for when loading has completed.
     */
    FeatureFlags.prototype._loadSchool = function() {
        var self = this;
        return new Promise(function(resolve, reject) {
            chrome.storage.local.get(SETTINGS.STORAGE.SCHOOL, function(info) {
                if (chrome.runtime.lastError) {
                    Logger.error('FeatureFlags: Error fetching school');
                    reject();
                    return;
                }

                var schoolInfo = info && info[SETTINGS.STORAGE.SCHOOL];
                if (schoolInfo && schoolInfo.name) {
                    Logger.info('FeatureFlags: Loaded school info: ' +
                        JSON.stringify(schoolInfo));
                    self._schoolResolver(schoolInfo.name);
                }
                resolve();
            });
        });
    };

    /**
     * Store information on the school for the feature flags.
     * @param {object} school The school information to store.
     * @return {Promise} A promise for storing the school information.
     */
    FeatureFlags.prototype._storeSchool = function(school) {
        Logger.info('FeatureFlags: Storing school info: ' +
            JSON.stringify(school));
        // Return a promise for setting storage.
        return new Promise(function(resolve, reject) {
            var schoolStorage = {};
            schoolStorage[SETTINGS.STORAGE.SCHOOL] = {name: school};
            // Set the storage data.
            chrome.storage.local.set(schoolStorage, function() {
                if (chrome.runtime.lastError) {
                    Logger.error('FeatureFlags: Unable to save school info');
                    reject();
                } else {
                    Logger.info('FeatureFlags: Saved school info');
                    resolve();
                }
            });
        });
    };

    /**
     * Helper method to check a flag for a school.
     * @param {object} school The school info.
     * @param {string} key The feature to check.
     * @return {boolean} If the flag is valid.
     */
    FeatureFlags.prototype._checkFlag = function(school, key) {
        // Guard against having no school name.
        if (!school) {
            Logger.info('FeatureFlags: Feature disabled: "' + key + '"');
            return false;
        }

        var flag = flags && flags[key];
        // Guard against unknown features.
        if (!flag) {
            Logger.info('FeatureFlags: Feature disabled: "' + key + '"');
            return false;
        }

        var value = _.contains(flag, '') || _.contains(flag, school);
        Logger.info('FeatureFlags: Feature ' + (value ? 'en' : 'dis') +
            'abled: "' + key + '"');
        return value;
    };

    /**
     * Set the school for feature flag requests.
     * @param {object} school The school to use for the feature flag.
     */
    FeatureFlags.prototype.setSchool = function(school) {
        this._schoolResolver(school);
        return Promise.all([
            this._schoolPromise,
            this._storeSchool(school)
        ]);
    };

    /**
     * Request if a feature is enabled.
     * @param {string} key The feature to check.
     * @return {Promise} A promise for when the key can and has been evaluated.
     */
    FeatureFlags.prototype.isEnabled = function(key) {
        var self = this;
        Logger.info('FeatureFlags: Requesting feature: "' + key + '"');
        // Wait for the school name, then create and resolve the flag.
        return this._schoolPromise.then(function(school) {
            return self._checkFlag(school, key);
        });
    };

    return FeatureFlags;
});