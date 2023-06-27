define([
    'amd/logger/logger',
    'amd/qsr/tracker'
], function(
    Logger,
    Tracker
) {
    /**
     * Create a new state from a state object or by capturing all shared
     * trackers.  If an empty state is desired, pass an empty object as
     * `state`.
     * @param {object} [state] An optional initial state. If not provided, the
     *   current tracker state will be used.
     * @param {Date} [timestamp] An optional timestamp when using `state`.
     */
    function State(state, timestamp) {
        if (state) {
            this.state = state;
            this.timestamp = State.validateTimestamp(timestamp) || new Date();
        } else {
            // The current Tracker state is captured here.
            this.capture();
        }
    }

    /**
     * Convenience method to get the current tracker state.
     * @returns {State} The current tracker state.
     */
    State.currentTrackerState = function() {
        return new State();
    };

    /**
     * Validate a timestamp. This makes sure it is a valid date.
     * @param {Date|string} timestamp The timestamp to validate.
     * @returns {Date|undefined} A date in the future, if valid.
     */
    State.validateTimestamp = function(timestamp) {
        // Guard against falsy values.
        if (!timestamp) { return; }
        // Convert any strings into a date.
        if (typeof timestamp === 'string') {
            timestamp = new Date(timestamp);
        }
        // Guard against objects that don't have getTime.
        if  (typeof timestamp.getTime !== 'function') { return; }
        // Guard against invalid times.
        if (isNaN(timestamp.getTime())) { return; }

        // The time stamp has been validated, return it.
        return timestamp;
    };

    /**
     * Restore a state from a dumped object.
     * @param {string|object} data The dumped data.
     * @return {State|undefined} A state object, if the data contained a state.
     */
    State.restore = function(data) {
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) { return; }
        }
        if (!data || !('state' in data)) { return; }
        return new State(data.state, data.timestamp);
    };

    State.prototype.state = null;
    State.prototype.timestamp = null;

    /**
     * Helper method to capture the current Tracker state.
     */
    State.prototype.capture = function() {
        var state = {};

        Tracker.names().forEach(function(name) {
            var tracker = Tracker.instance(name);
            state[name] = tracker.state();
        });

        this.state = state;
        this.timestamp = new Date();
    };

    /**
     * JSON serialization definition.
     * @return {object} An object that better represents the captured state.
     */
    State.prototype.toJSON = function() {
        return this.state;
    };

    /**
     * Dump data that can be used for creating a full matching state.
     * @return {object} An object ready for serialization and saving.
     */
    State.prototype.dump = function() {
        return {
            state: this.state,
            timestamp: this.timestamp
        };
    };

    /**
     * Get one named state.
     * @param {string} name The state to fetch.
     * @return {mixed|null} The state, if available, or null.
     */
    State.prototype.getNamed = function(name) {
        if (!(name in this.state) || !this.state.hasOwnProperty(name)) {
            return null;
        }
        return this.state[name];
    };

    /**
     * Check if this state matches another state.
     * @param {string|object} state The state to compare against.
     * @return {boolean} If the states match.
     */
    State.prototype.compare = function(state) {
        if (!state) {
            return false;
        } else if (typeof state !== 'string') {
            state = JSON.stringify(state);
        }
        return JSON.stringify(this) === state;
    };

    return State;
});