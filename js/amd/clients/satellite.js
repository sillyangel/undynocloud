define([
    'amd/clients/api', 'amd/settings', 'amd/logger/logger',
    'amd/lib/uuid', 'amd/utils/healthCheckInfo'
], function(
    APIClient, SETTINGS, Logger,
    UUID, HealthCheckInfo
) {
    var SatelliteApiClient = function() {

        var openCabraFragment = "/v1/Cabras/<cabrauuid>/Open?access_token=<access_token>",
            addCabraFrameFragment = "/v1/Cabras/<cabrauuid>/Frames?access_token=<access_token>",
            userCabraFragment = "/v1/Cabras/<cabrauuid>/User?access_token=<access_token>",
            attachFragmentV1 = "/v1/broadcast/attach",
            attachFragmentV2 = "/v2/broadcast/attach",
            CABRA_UUID = "<cabrauuid>",
            ACCESS_TOKEN = "<access_token>",
            IGNORE_COMMANDS = {
                USER_LEFT : "user_left",
                USER_JOINED : "user_joined"
            },
            _this = this;

        this.coreAccessToken = null;
        this.accessToken = '';
        this.broadcastId = '';
        this.baseUrl = '';
        this._hubConnection = false;
        this._hubProxyMonitor = false;
        this.isStopping = false;

        /**
         * Initialze the client before connecting.
         * @param {object} object The connection parameters.
         * @returns {Deferred} A deferred promise for connecting.
         */
        this.init = function(object) {
            Object.extend(this, object);
            return this._initHubConnection();
        };

        this.stop = function(){
            this.isStopping = true;
            this.unsubscribe();
            this._hubConnection.stop();
        };

        /**
         * Initialze the SignalR hub connection.
         * @returns {Deferred} A deferred promise for connecting.
         */
        this._initHubConnection = function() {
            var promise;

            // Guard against missing access tokens.
            if (!this.coreAccessToken) {
                throw new SystemError("Core access token is required!");
            }

            // Guard against having no base URL.
            if (!this.baseUrl) {
                throw new SystemError("Base url is required !");
            }

            this.isStopping = false;
            this._hubConnection = $.hubConnection( this.baseUrl, {
                "qs": {
                    "access_token": this.accessToken
                },
                "logging": true,
                "pingInterval": null
            })
                .starting(function () {
                    Logger.debug('SignalR Session Starting');
                })
                .received(function (msg) {
                    HealthCheckInfo.Satellite_Failed = false;
                    Logger.debug('SignalR Session Received', msg);
                })
                .connectionSlow(function () {
                    Logger.warn('SignalR Session Connection Slow');
                })
                .reconnecting(function () {
                    Logger.warn('SignalR Session Reconnecting');
                })
                .reconnected(function () {
                    HealthCheckInfo.Satellite_Failed = false;
                    Logger.warn('SignalR Session Reconnected');
                })
                .stateChanged(function (state) {
                    Logger.warn('SignalR Session State Changed', state);
                })
                .disconnected(function () {
                    Logger.warn('SignalR Session Disconnected');
                    _this._handleSignalRDisconnect();
                })
                .error(function (error) {
                    HealthCheckInfo.Satellite_Failed = true;
                    Logger.error('SignalR Session Errored', error);
                });

            this._hubConnection.log = function(msg) {
                Logger.debug('SignalR Session', msg);
            };

            this._hubProxyMonitor.transportConnectTimeout = 15000;//5 seconds is too short, matches teacher client now
            this._hubProxyMonitor = this._hubConnection.createHubProxy("broadcasthub");
            this.subscribe();
            promise = this._hubConnection.start();
            return this._checkHubConnection(this._hubConnection, promise);
        };

        this.subscribe = function () {
            this._hubProxyMonitor.on("newFrame", _this.observer)
                .on("newFrames",_this.observer);
        };

        this.unsubscribe = function () {
            this._hubProxyMonitor.off("newFrame", _this.observer)
                .off("newFrames",_this.observer);
        };

        this._handleSignalRDisconnect = function() {
            if (!this.isStopping) {
                var error = new Error();
                error.name = 'Satellite SignalR Error';
                error.message = 'SignalR connection with the satellite server was lost.';
                HealthCheckInfo.Satellite_Failed = true;
                $.trigger(SETTINGS.EVENTS.FATAL_ERROR, error);
            }
        };

        this._checkHubConnection = function ( hubConnection, promise ) {
            //TODO can probably sort out this indirection
            return new Promise (function (resolve, reject) {
                promise.done(function () {
                    Logger.debug('Now connected, connection ID=' + hubConnection.id);
                    clearTimeout(tookTooLong);
                    resolve();
                }).fail(function (jqXHR, textStatus, errorThrown) {
                    Logger.error( errorThrown.message, jqXHR.StackTrace);
                    clearTimeout(tookTooLong);
                    reject();
                });
                var tookTooLong = setTimeout(function(){
                    Logger.debug("satelitte signalr connection took to long, rejecting promise.");
                    reject();
                },30000);
            });
        };

        this._attachToHub = function( hubConnectionId, retry, resolve, reject ){
            //todo: remove retry safely everywhere
            //also can simply return ._attach instead 
            //of this weird callback shell game
            _this._attach(hubConnectionId).then(function(data){
                resolve(data);
            }, function(){
                reject();
            });
        };

        this.observer = function ( event, data, eventType ) {
            Logger.debug(eventType + ' Event', {event: event, data: data });
            var isArray = isArrayFunc( event );
            if ( event && isArray ) {
                $.each( event, _this._generatePubsubEvent);
            } else if ( event ) {
                _this._generatePubsubEvent(event);
            }
        };

        /**
         *
         * @param event
         * @returns {boolean}
         * @private
         */
        this._generatePubsubEvent = function ( event ) {

            var payloadId;

            if ( !(event && typeof event === "object")) {
                throw new SystemError("Broadcast object has wrong format !");
            }

            payloadId = event.payload_id;

            // Skip event with ignoring payload id
            if ( payloadId === IGNORE_COMMANDS.USER_JOINED || payloadId === IGNORE_COMMANDS.USER_LEFT ) {
                Logger.error("Unsupported payload", "Get from server payload with unsupported payload id " + payloadId );
                return true;
            }

            if ( payloadId === SETTINGS.EVENTS.NEW_OBJECT ) {
                //it is not desirable to have this be the broadcastObject wrapper
                //TODO unwrap this and just do the right thing
                $.trigger( _this._getEventNameFromBroadcastObjectForNewObj(event), { "broadcastObject" : event });
            } else if ( payloadId === SETTINGS.EVENTS.BROADCAST_END ||  payloadId === SETTINGS.EVENTS.OPEN_OBJECT ) {
                $.trigger( _this.broadcastId +"/" + payloadId, event);
            } else {
                throw new SystemError( payloadId +  " - is unknown type of payload !");
            }
        };

        /**
         * Generate event name for events with payload_id
         * open_object or new_object
         * @param item
         * @returns {*}
         * @private
         */
        this._getEventNameFromBroadcastObjectForNewObj = function ( item ) {

            if ( item.cabra_id && item.payload_id ) {
                return item.cabra_id  + item.payload_id;
            }

            throw new SystemError("Broadcast object has wrong format !");
        };

        /**
         * Assumes init has been called and stored connectionId properly
         * @returns {Promise}
         */
        this.attach = function() {
            if (!_this._hubConnection || !_this._hubConnection.id){
                throw new SystemError("hubConnection not initialized - cannot call attach");
            }
            //TODO can probably clean up this indirection
            return new Promise(function(resolve, reject) {
                _this._attachToHub(_this._hubConnection.id, 0, resolve, reject);
            });
        };

        /**
         * Determine which attach fragment to use.
         * @returns {string} The attach fragment to use.
         */
        this._attachFragment = function() {
            return attachFragmentV2;
        };

        /**
         * Attach to a satellite broadcast.
         * @param hubConnectionId
         * @returns {Promise}
         */
        this._attach = function(hubConnectionId) {
            var token = this.coreAccessToken;
            var paramObj = {
                id: this.broadcastId,
                connection_id: hubConnectionId,
                access_token: token
            };
            var fragment = this._attachFragment() + "?" + $.param(paramObj);

            return new Promise(function (resolve, reject) {
                _this.get(fragment, false, SETTINGS.DEFAULT_RETRY_OPTIONS)
                .then(
                    function(data) {
                        Logger.debug(fragment + " Successful", data);
                        // Complete the attach ASAP.
                        _this._attachSuccessful(data);
                        resolve(data);
                    },
                    function (errorThrown) {
                        //rewrote to match the logger.error expectation but I think this needs 
                        //to be rewritten to follow dyknow conventions
                        Logger.error( "attach error: " + (errorThrown.message || errorThrown.error_description), errorThrown.stack);
                        reject();
                    }
                );
            });
        };

        /**
         * Complete attaching when successful.
         * @param {object} data The data returned when attaching.
         */
        this._attachSuccessful = function(data) {
            // Get the new access token.
            var token = data && data.access_token;
            if (token) {
                Logger.info("Satellite provided access token", token);
                _this.accessToken = token;
            } else {
                throw new SystemError("Access token not provided!");
            }
        };

        /**
         * Enters a cabra.
         * @param {string} cabraUUID The cabra UUID.
         * @returns {Deferred} A promise for entering the cabra.
         */
        this.enterCabra = function(cabraUUID) {
            var fragment = userCabraFragment
                .replace(CABRA_UUID, cabraUUID)
                .replace(ACCESS_TOKEN, this.accessToken);

            return this.post(fragment, false, SETTINGS.DEFAULT_RETRY_OPTIONS);
        };

        this.addCabraFrame = function (cabraUUID, rule, conversationId, payloadObj) {
            var frame = {
                    payload_id : rule.payload_id,
                    conversation_id : conversationId,
                    payload : payloadObj,
                    to : rule.to,
                    object_id : UUID()
                },
                fragment = addCabraFrameFragment
                    .replace(CABRA_UUID, cabraUUID)
                    .replace(ACCESS_TOKEN, this.accessToken);
            return this.post(fragment, { "headers" : { "Content-Type": "application/json" } , "data" : JSON.stringify(frame) }, SETTINGS.DEFAULT_RETRY_OPTIONS, true);
        };

        //TODO: Move this out to an S3 Client because it is
        this.thumbnailResponse = function (url, imgData, fileType) {
            return this.put(
                url, 
                { "data" : imgData, processData: false, contentType: false, headers : { "Content-Type": fileType } }, 
                {
                    times:3,
                    statusCodes: [500, 501, 502, 503, 504, 505, 404]//race conditions in s3 can cause it to return a 404
                },
                true//errors here need to tear all the way down 
            );
        };
    };

    extend(SatelliteApiClient, APIClient);

    return SatelliteApiClient;
});