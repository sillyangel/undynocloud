define([
    'amd/logger/logger'
], function(
    Logger
) {
    var instances = {};

    /**
     * Tracker constructor function.
     * For shared trackers, `Tracker.instance` should be used instead of
     * constructing a new tracker.
     */
    function Tracker(name) {
        Logger.info('Tracker (' + name + '): Initializing');
        this.name = name;
        this._state = null;
        this.timestamp = null;
    }

    /**
     * Static tracker instance getter.
     * @param {string} name The name of the tracker to get.
     * @return {Tracker} The tracker instance.
     */
    Tracker.instance = function(name) {
        var hasName = name in instances;

        // Guard against bad tracker requests.
        if (hasName && !instances.hasOwnProperty(name)) {
            var message = 'Invalid tracker instance requested: "' + name + '"';
            Logger.error(message);
            throw new Error(message);
        // Construct instances that don't exist.
        } else if (!hasName) {
            instances[name] = new Tracker(name);
        }

        return instances[name];
    };

    /**
     * Get the names of all initialized shared trackers.
     * @return {string[]} Names of the shared trackers.
     */
    Tracker.names = function() {
        return Object.keys(instances);
    };

    /**
     * Purge all tracker instances.
     * NB: Only use this for testing!
     */
    Tracker._purge = function() {
        instances = {};
    };

    /**
     * Tracker state getter/setter.
     * @param {mixed|undefined} A state, if setting.
     * @return {mixed} The stored state.
     */
    Tracker.prototype.state = function() {
        if (arguments.length) {
            this._state = arguments[0];
            this.timestamp = this._state ? new Date() : null;
            Logger.info('Tracker (' + this.name + '): Set state', this._state);
        }
        return this._state;
    };

    return Tracker;
});