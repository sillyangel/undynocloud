define([
    'amd/filesystem',
    'amd/logger/logger',
    'amd/qsr/attentionManager',
    'amd/qsr/blockingManager',
    'amd/qsr/state',
    'amd/settings',
    'underscore',
], function(
    filesystem,
    Logger,
    AttentionManager,
    BlockingManager,
    State,
    SETTINGS,
    _
) {
    /**
     * Quick state restore constructor.
     * @param {object} idn The required IDN instance.
     */
    function QSR(idn) {
        Logger.info('QSR: constructor');

        if (!idn) {
            throw new Error('Unable to setup QSR without IDN.');
        }

        this.idn = idn;
        this.running = false;
        this.active = false;
        this.file = null;
        this.state = null;
        this._timeout = null;
    }

    // Time between QSR ticks.
    QSR.TICK_TIME = 5 * 1000;
    // Time before expiring an active QSR state.
    QSR.EXPIRATION_TIME = 5 * 60 * 1000;

    /**
     * Check if a state has expired.
     * @param {State} state Check if this state has expired.
     * @return {boolean} If the state has expired.
     */
    QSR.prototype.expired = function(state) {
        if (!state.timestamp) { return false; }
        var diff = (new Date()) - state.timestamp;
        return diff >= QSR.EXPIRATION_TIME;
    };

    /**
     * Start running QSR.
     */
    QSR.prototype.start = function() {
        Logger.info('QSR: start');
        if (this.running) {
            Logger.warn('QSR: Already running!');
            return;
        }
        this.running = true;
        this.active = false;
        this.state = new State({});
        this.loadState().then(this._delayTick.bind(this));
    };

    /**
     * Stop QSR from running.
     */
    QSR.prototype.stop = function() {
        Logger.info('QSR: stop');
        if (!this.running) {
            Logger.warn('QSR: Already stopped!');
            return;
        }
        this.running = false;
        this.active = false;
        clearTimeout(this._timeout);
        this._timeout = null;
    };

    /**
     * Clears and sets the state.
     */
    QSR.prototype.resetState = function() {
        return this.setState(new State({}));
    };

    /**
     * Set the current QSR state.
     * @param {object} state The new state to store.
     */
    QSR.prototype.setState = function(state) {
        var self = this;
        this.state = state;
        return this.writeState().catch(function(e) {
            Logger.error('QSR: Failed to write state!', e);
            // There may be an issue with the file handle if there was an error.
            self.file = null;
        });
    };

    /**
     * Write the current state to file.
     */
    QSR.prototype.writeState = function() {
        var state = JSON.stringify(this.state.dump());
        var blob = new Blob([state], {type: 'text/plain'});
        return this.getFile().then(function(file) {
            return filesystem.writeToFile(file, blob);
        });
    };

    /**
     * Get the QSR state file.
     * @param {bool} [skipInit] If creating the file should be skipped.
     */
    QSR.prototype.getFile = function(skipInit) {
        if (this.file) {
            return Promise.resolve(this.file);
        }
        var self = this;
        var fn = skipInit ? 'getFile' : 'initFile';
        return filesystem[fn]('qsr.json').then(function(file) {
            Logger.info('QSR: retrieved state file');
            self.file = file;
            return file;
        });
    };

    /**
     * Read the QSR state.
     */
    QSR.prototype.readState = function() {
        return this.getFile(true).then(filesystem.readFile);
    };

    /**
     * Load the QSR state from file.
     */
    QSR.prototype.loadState = function() {
        var self = this;
        Logger.info('QSR: loading saved state');

        return this.readState().then(
            function(data) {
                Logger.info('QSR: state read', data);
                var state = State.restore(data);
                if (state) { self.state = state; }
            },
            function(error) {
                Logger.warn('QSR: unable to read state', error);
            }
        );
    };

    /**
     * Trigger state restoration.
     * @param {object} [state] An optional state to restore. If not provided,
     *   this method will restore the cached QSR state.
     */
    QSR.prototype.restore = function(state) {
        // NB This will restore the cached QSR state if state is not provided.
        state = arguments.length ? state : this.state;
        AttentionManager.instance().restoreState(state);
        BlockingManager.instance().restoreState(state);
    };

    /**
     * QSR tick method while running.
     */
    QSR.prototype.tick = function() {
        // Shortcut if not running.
        if (!this.running) {
            Logger.warn('QSR: Already stopped, canceling tick!');
            return;
        }

        return this._tick()
        .catch(function(e) {
            Logger.warn('QSR: Rejected tick promise!', e);
        })
        .then(this._delayTick.bind(this));
    };

    /**
     * Private tick delay setup.
     */
    QSR.prototype._delayTick = function() {
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }
        this._timeout = _.delay(this.tick.bind(this), QSR.TICK_TIME);
    };

    /**
     * Private tick method to handle tracking and transitioning QSR states.
     * QSR sholud have:
     * - A communicating flag to know if IDN is actively communicating.
     * - A cached state for the last known (by QSR) applied state.
     * - A current Tracker state for what was last applied by CABRAs.
     * - An active flag to know if QSR is currently active.
     */
    QSR.prototype._tick = function() {
        var promise = null;
        var complete = function(promise) {
            return promise || Promise.resolve();
        };

        var communicating = this.idn.isCommunicating();
        var cachedState = this.state;
        var currentState = State.currentTrackerState();

        Logger.info('QSR: tick (' + (communicating ? '' : 'not ') + 'communicating)');

        // Handle expired states.
        if (!communicating && this.expired(cachedState)) {
            if (this.active) {
                Logger.info('QSR: expired, resetting');
                promise = this.resetState();
                this.restore();
            } else {
                Logger.info('QSR: expired, moving on');
            }
            return complete(promise);
        }

        // Switch from communicating to active.
        if (!communicating && !this.active) {
            Logger.info('QSR: activating');
            this.active = true;

        // Switch from active to communicating.
        } else if (communicating && this.active) {
            Logger.info('QSR: deactivating');
            this.active = false;

            // Restore the current state, if they didn't match.
            if (!currentState.compare(cachedState)) {
                Logger.info('QSR: restoring tracker state', currentState);
                // Restore the current tracker state.
                this.restore(currentState);
            }

            // NB: State will be captured with following communicating test.
        }

        // Capture current state if communicating.
        // NB: State is captured any time while communicating to make sure the
        //     expiration is always updated.
        if (communicating) {
            if (currentState.compare(cachedState)) {
                Logger.info('QSR: touching state');
            } else {
                Logger.info('QSR: capturing state', currentState);
            }
            promise = this.setState(currentState);

        // Restore QSR state if active.
        } else if (this.active && !currentState.compare(cachedState)) {
            Logger.info('QSR: restoring state', cachedState);
            // Restore the cached state.
            this.restore();

        // No change necessary.
        } else {
            Logger.info('QSR: ' + (this.active ? 'is' : 'not') +
                ' active, no change needed');
        }

        return complete(promise);
    };

    return QSR;
});