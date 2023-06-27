define([
    'amd/clients/api', 'amd/settings', 'amd/logger/logger',
    'underscore', 'amd/clients/signalr-autotransport2', 'amd/clients/delaySwitchboardTracker'
], function(
    APIClient, SETTINGS, Logger,
    _, AutoTransport, delaySwitchboardTracker
) {
    var CoreApiClient = function () {
        var _this = this,
            EVENTS = {
                "JOIN_EVENT": "join_event",
                "LEAVE_EVENT": "leave_event",
                "LEAVE_FROM_ALL": "leave_from_all",
                "CONTROL_CHANGED_EVENT": "control_changed_event"
            };

        /**
         * Show state of core client
         * @type {null}
         */
        this.events = EVENTS;
        this.accessToken = '';
        this._hubConnection = false;
        this._autoTransport = null;
        this.baseUrl = SETTINGS.DYDEV.CORE_SERVER + 'v1/';
        this.getUserFragment = 'users/get?id=me&access_token=';
        /**
         * The hub connection.
         */
        this._hubProxyMonitor = false;
        /**
         * If a disconnect should be processed.
         * This should only be false if a disconnect is in process.
         */
        this._processDisconnect = true;
        /**
         * If a reset is being processed.
         */
        this._processingReset = false;
        /**
         * If a delaySwitchboard is being processed.
         */
        this._processingDelay = false;
        delaySwitchboardTracker.reset();
        /**
         * When restarting, if the restart should be handled quickly instead of
         * with a delay.
         */
        this._quickRestart = false;
        /**
         * Reference to a connection timeout timer.
         */
        this._connectionTimeout = null;

        /**
         * aggressively backing off retries since 503 errors returned from our server 
         * when Chrome is behind a proxy (such as a content filter) show up as rejected 
         * instead of showing up as 503 status code. chrome reports it as net::ERR_TUNNEL_CONNECTION_FAILED 
         * in console but does not expose that information to the extension
         */
        this._retryDelay = 0;

        /**
         * Stop the client without reconnecting.
         */
        this.stop = function() {
            if (_this._processDisconnect) {
                _this._processDisconnect = false;
                $.on(SETTINGS.EVENTS.DID_DETACH_FROM_ALL_BROADCAST, _this.didDetachFromAllBroadcastObserverOnStop);
                $.trigger(EVENTS.LEAVE_FROM_ALL);
            }
        };

        /**
         * Restart CoreAPIClient
         * @param {boolean} quick If the restart should be quick.
         */
        this.restart = function(quick) {
            // Only process the restart if not already in progress.
            if (_this._processDisconnect) {
                _this._processDisconnect = false;
                // Determine if this is explicitly a quick restart.
                _this._quickRestart = quick === true;
                Logger.debug('Switchboard restarting' + (_this._quickRestart ? ' quickly' : ''));
                // Listen for the detach completing from BSM.
                $.on(SETTINGS.EVENTS.DID_DETACH_FROM_ALL_BROADCAST, _this.didDetachFromAllBroadcastObserverOnRestart);
                // Trigger the leaving all broadcasts.
                $.trigger(EVENTS.LEAVE_FROM_ALL);
            } else {
                Logger.debug("Switchboard is already restarting");
            }
        };

        /**
         * Initialize the hub connection setting up all event listeners.
         */
        this.initHubConnection = function() {
            if (!this.accessToken) {
                throw new SystemError("Access token must be initialized before this call !");
            }
            Logger.info('Core client starting hub connection.');
            this._hubConnection = $.hubConnection(SETTINGS.DYDEV.CORE_SERVER, {
                    "qs": {
                        "access_token": this.accessToken
                    },
                    "logging": true,
                    "pingInterval": null
                })
                .starting(function () {
                    Logger.debug('SignalR Switchboard Starting');
                })
                .received(function (msg) {
                    Logger.debug('SignalR Switchboard Received', msg);
                })
                .connectionSlow(function () {
                    Logger.warn('SignalR Switchboard Connection Slow');
                })
                .reconnecting(function () {
                    Logger.warn('SignalR Switchboard Reconnecting');
                })
                .reconnected(function () {
                    Logger.warn('SignalR Switchboard Reconnected');
                    this.reconnectDelay = 2000;//reset back to normal
                    _this._retryDelay = 0;
                })
                .stateChanged(function (state) {
                    Logger.warn('SignalR Switchboard State Changed', state);
                    $.trigger(SETTINGS.EVENTS.CORE_CLIENT_STATE_CHANGED, state.newState);
                })
                .disconnected(function () {
                    if (_this._processingReset) {
                        Logger.info('Ignoring disconnect while resetting.');
                        return;
                    }
                    Logger.warn('SignalR Switchboard Disconnected');
                    _this._handleSignalRDisconnect();
                })
                .error(function (error) {
                    Logger.error('SignalR Switchboard Errored: ' + (error ||""));
                    if ((error && error.context && error.context.status === 503)||
                    (error && error.source && error.source.status === 503) ){
                        this.reconnectDelay = 15000;//if we hit a 503, we need to chill out
                    } else if (error && error.context && (error.context.status === 401 || error.context.status === 403)) {
                        //dont want to tear down every time, so only report errors if we know they're fatal
                        //otherwise leave it up to disconnect to know to 
                        $.trigger(SETTINGS.EVENTS.FATAL_ERROR, error);
                    } else if (error && error.error_code === 4908) {
                        //dont want to tear down every time, so only report errors if we know they're fatal
                        //otherwise leave it up to disconnect to know to 
                        $.trigger(SETTINGS.EVENTS.FATAL_ERROR, error);
                    } else {
                        _this._retryDelay += 1;
                        this.reconnectDelay = 2000 + _this._retryDelay * 5 * 1000;
                    }            
                });
            this._retryDelay = 0;
            this._hubConnection.reconnectDelay = 2000;//typically gets overwritten by api

            this._hubConnection.log = function(msg) {
                Logger.debug('SignalR Switchboard', msg);
            };
            var hubName = 'switchboard';
            this._hubProxyMonitor = this._hubConnection.createHubProxy(hubName);
            this._hubProxyMonitor.transportConnectTimeout = 15000;//5 seconds is too short, matches teacher client now
            this._autoTransport = AutoTransport.create();
            this._autoTransport.connection = this._hubConnection;
            this._startHubConnection();
        };
        /**
         * Start the hub connection.
         * NB: The hub connection must first be initialized.
         */
        this._startHubConnection = function() {
            // Die if the hub connection has not been initialized.
            if (!_this._hubConnection) {
                var message = 'Can not start uninitialized hub connection!';
                Logger.error(message);
                throw new Error(message);
            }
            // Die if the autoTransport has not been created.
            if (!_this._autoTransport) {
                var message = 'Can not start without autoTransport!';
                Logger.error(message);
                throw new Error(message);
            }
            // Helper to cancel the connection retry timeout.
            var cancelConnectionTimeout = function() {
                if (!_this._connectionTimeout) { return; }
                clearTimeout(_this._connectionTimeout);
                _this._connectionTimeout = null;
            };

            this._processingReset = false;
            this.subscribe();
            this._autoTransport.start().then(
                function() {
                    Logger.info('Core client connected.');
                    cancelConnectionTimeout();
                },
                function() {
                    Logger.debug("Signalr start returned failure.");
                    cancelConnectionTimeout();
                    _this.restart();
                }
            );

            // Wait 30 seconds, and if it hasn't started try again.
            this._connectionTimeout = _.delay(function() {
                Logger.debug("Signalr took too long starting, Will restart.");
                cancelConnectionTimeout();
                _this.restart();
            }, 30000);
        };

        /**
         * Check if the SignalR is currently communicating.
         * @return {boolean} If the client is currently communicating.
         */
        this.isCommunicating = function() {
            return this._processingDelay || (this._hubConnection && this._hubConnection.state === 1);
        };

        /**
         * Handler for when detached from all broadcasts while restarting.
         */
        this.didDetachFromAllBroadcastObserverOnRestart = function() {
            $.off(SETTINGS.EVENTS.DID_DETACH_FROM_ALL_BROADCAST, _this.didDetachFromAllBroadcastObserverOnRestart);
            _this.unsubscribe();
            _this._hubConnection.stop();

            if (_this._quickRestart === true) {
                Logger.info('Core client will restart now.');
                _this._quickRestart = false;
                _this._restartAfterDetach();
            } else {
                Logger.info('Core client will restart in 30 seconds.');
                _.delay(_this._restartAfterDetach, 30000);
            }
        };

        this._restartAfterDetach = function() {
            _this._processDisconnect = true;
            _this.initHubConnection();
        };

        this.didDetachFromAllBroadcastObserverOnStop = function () {
            $.off(SETTINGS.EVENTS.DID_DETACH_FROM_ALL_BROADCAST, _this.didDetachFromAllBroadcastObserverOnStop);
            _this.unsubscribe();
            _this._hubConnection.stop();
            _this._processDisconnect = true;
            $.trigger(SETTINGS.EVENTS.CORE_CLIENT_STOPS);
        };

        this.subscribe = function () {
            _this._hubProxyMonitor
                .on("Join", _this.joinObserver)
                .on("Leave", _this.leaveObserver)
                .on("ControlChanged", _this.controlChangedObserver)
                .on("ResetCustomer", _this.resetCustomerObserver)
                .on("DelaySwitchboard", _this.delaySwitchboardObserver);
        };

        this.unsubscribe = function () {
            _this._hubProxyMonitor
                .off("Join", _this.joinObserver)
                .off("Leave", _this.leaveObserver)
                .off("ControlChanged", _this.controlChangedObserver)
                .off("ResetCustomer", _this.resetCustomerObserver)
                .on("DelaySwitchboard", _this.delaySwitchboardObserver);
        };

        this._handleSignalRDisconnect = function() {
            var error = new Error();
            error.name = 'Switchboard Error';
            error.message = 'Switchboard will tear down because signalr disconnected.';
            $.trigger(SETTINGS.EVENTS.FATAL_ERROR, error);
        };

        this.leaveObserver = function (broadcastInstructions) {
            $.trigger(_this.events.LEAVE_EVENT, broadcastInstructions);
        };

        this.controlChangedObserver = function (broadcastInstructions) {
            $.trigger(_this.events.CONTROL_CHANGED_EVENT, broadcastInstructions);
        };

        /**
         * Restart the hub connection without tearing down broadcasts.
         */
        this.resetCustomerObserver = function(broadcastInstructions) {
            Logger.info('Reseting client.');
            _this._processingReset = true;
            _this.unsubscribe();
            Logger.info('Stopping client.');
            _this._hubConnection.stop();
            Logger.info('Restarting client.');
            _this._startHubConnection();
        };

        /**
         * Restart the hub connection without tearing down broadcasts.
         */
        this.delaySwitchboardObserver = function(delayConfig) {
            Logger.info('delaying switchboard: ' + (delayConfig && delayConfig.delay));
            _this._processingReset = true;
            _this._processingDelay = true;
            delaySwitchboardTracker.delaySwitchboard = true;
            _this.unsubscribe();
            Logger.info('Stopping client (delay).');
            var now = _.now();
            _this.delayTargetTime = now + delayConfig.delay;
            _this._hubConnection.stop();
            _this.afterDelaySwitchboard();
        };

        this.afterDelaySwitchboard = function (){
            if (_.now() >= _this.delayTargetTime) {
                Logger.info('Restarting client. (delay)');
                _this._processingDelay = false;
                delaySwitchboardTracker.reset();
                _this._startHubConnection();
            } else {
                _.delay(_this.afterDelaySwitchboard, 60000);//check in every minute
            }
        };

        this.joinObserver = function (broadcastInstructions) {
            $.trigger(_this.events.JOIN_EVENT, broadcastInstructions);
        };

        this.getMe = function () {
            return this.get(this.getUserFragment + this.accessToken, SETTINGS.DEFAULT_RETRY_OPTIONS);
        };

        this.getActivityConfig = function (date_time, deviceOffset) {
            if (!date_time) { date_time = "fake";}
            if (!deviceOffset) { deviceOffset = 0;}
            return this.get("activitydata?date_time=" + date_time + "&device_offset=" + deviceOffset + "&access_token=" + this.accessToken, SETTINGS.DEFAULT_RETRY_OPTIONS);
        };
        this.uploadToUrl = function (url, buffer){
            return this.put(
                url, 
                { "data" : buffer, processData: false, contentType: false, headers : { "Content-Type": "application/json", "Content-Encoding": "gzip" } }, 
                SETTINGS.DEFAULT_RETRY_OPTIONS, 
                false//do not force a teardown due to errors here
            );
        };
        this.checkHeadOfUrl = function (url) {
            return this.head(url);
        };
    };

    extend(CoreApiClient, APIClient);
    return CoreApiClient;
});
