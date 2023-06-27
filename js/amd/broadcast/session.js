define([
    'amd/settings', 'amd/logger/logger', 'amd/clients/satellite',
    'amd/cabra/sessionFactory', 'amd/cabra/session', 'amd/broadcast/broadcastSession.events',
    'amd/cabra/cabraSession.events', 'amd/lib/EventEmitter', 'amd/sandbox',
    'underscore', 'amd/utils/healthCheckInfo'
], function(
    SETTINGS, Logger, SatelliteApiClient,
    CabraSessionFactory, CabraSession, broadcastEvents,
    cabraEvents, EventEmitter, Sandbox,
    _, HealthCheckInfo
) {
    var sandbox = new Sandbox().init();
    var BroadcastSession = function(coreAccessToken) {
        this.broadcastId = "";
        this.url = "";
        this.coreAccessToken = coreAccessToken;
        this.accessToken = "";
        this.accountId = "";
        this.deviceId = "";
        this.roster = null;
        this.pendingCabras = {};
        this.activeCabras = {};
        this.pendingOpenObjects = [];//to support the race condition between signalr open_object and attach returning (note: this should be an array still even after above TODOs)
        this._client = false;
        this._broadcastInfo = false;

        /**
         * Initialize a broadcast session.
         * @param {object} broadcastSession The session settings.
         * @param {string} coreAccessToken A core access token for attach v2.
         */
        this.init = function(broadcastSession) {
            this.initParams(broadcastSession);
            Logger.info('Broadcast session using token for attach v2.',
                coreAccessToken);
            this.accessToken = this.coreAccessToken;
        
            this._client = new SatelliteApiClient();
            this._client.coreAccessToken = this.coreAccessToken;
        };

        /**
         * Initialize the broadcast session parameters.
         * @param {object} broadcastSession A key value set of options to set.
         */
        this.initParams = function(broadcastSession) {
            var validateKeys = ["broadcast_id", "url", "access_token"];
            var key, objectKey;
            for (key in broadcastSession) {
                // Shortcut to ignore the access token for attach V2.
                if (key === 'access_token') { continue; }

                objectKey = key.camelize();
                if (this.hasOwnProperty(objectKey)) {
                    // Validate object
                    if (validateKeys.indexOf(key) !== -1 && !broadcastSession[key]) {
                        throw new SystemError("Not valid broadcastSession object!", key);
                    }

                    this[objectKey] = broadcastSession[key];
                }
            }
        };

        /**
         * Attach to the broadcast.
         */
        this.attach = function() {
            var _this = this;
            this.willAttachToBroadcast();
            this.subscribe();

            var params = {
                broadcastId: _this.broadcastId,
                baseUrl: _this.url
            };

            // Choose the correct access token to provide.
            // Use the core token for attach V2.
            params.coreAccessToken = _this.coreAccessToken;

            //note: this internally calls attach in one shot at the end of the signalr initialization
            //the connection_id is an internal detail of the satClient

            // Return a promise for when attach has completed or failed.
            return this._client.init(params)
            // If successful, attach the client.
            .then(function() {
                return _this._client.attach();
            })
            // Notify if attaching was successful or not.
            .then(function(broadcastInfo) {
                _this.didAttachToBroadcast(broadcastInfo);
            }, function(err) {
                return _this.didFailToAttachToBroadcast(err);
            });
        };

        this.willAttachToBroadcast = function () {
            Logger.debug("Attempting to Attach to Broadcast (" + this.broadcastId + ") using Server " + this.url);
            //pubsub.publish(broadcastEvents.BroadcastSessionWillAttachEvent, { broadcast_id: this.broadcastId });
            //TODO: normalize on pubsub
            this.emitEvent(broadcastEvents.BroadcastSessionWillAttachEvent);
            sandbox.publish(broadcastEvents.BroadcastSessionWillAttachEvent, { "broadcast_id": this.broadcastId });
        };

        this.didAttachToBroadcast = function (broadcastInfo) {
            Logger.info("Attached to broadcast " + broadcastInfo.broadcast_id + " for Class " + 
                ((!!this.roster) ? (this.roster.name + "(" + this.roster.roster_id + ")") : "unknown") + 
                " as " + broadcastInfo.broadcast_user_type, broadcastInfo);
            HealthCheckInfo.Classroom_Name = this.roster.name;
            this._broadcastInfo = broadcastInfo;
            //if (!this.hasControl) {
            //    Logger.warn("WARNING: This user is controlled by another Class", broadcastInfo.control_roster);
            //}
            if (!this._didAttachToBroadcast()) {
                this.didFailToAttachToBroadcast();
            }
            //pubsub.publish(broadcastEvents.BroadcastSessionDidAttachEvent, { broadcast_id: this.broadcastId });
            //TODO: normalize on pubsub
            this.emitEvent(broadcastEvents.BroadcastSessionDidAttachEvent);
            sandbox.publish(broadcastEvents.BroadcastSessionDidAttachEvent, { "broadcast_id": this.broadcastId });
        };

        this.didFailToAttachToBroadcast = function (error) {
            //TODO: this code path is not used yet but should be

            Logger.error("Failed to Attach to broadcast " + this.broadcastId, error);

            this.unsubscribe();
            this._client.stop();

            //pubsub.publish(broadcastEvents.BroadcastSessionDidFailToAttachEvent, { broadcast_id: this.broadcastId, error: error });

            //TODO: not sure why this is necessary
            return new $.Deferred().reject(new SystemError("Attached failed !"));
        };

        this.didReceiveError = function (error) {
            //TODO: this code path is not used yet but should be

            Logger.error("Broadcast " + this.broadcastId + " did receive error", error);
            $.trigger(broadcastEvents.BroadcastSessionDidReceiveErrorEvent, [{ "broadcast_id": this.broadcastId, "error": error }]);
            //pubsub.publish(broadcastEvents.BroadcastSessionDidReceiveErrorEvent, { broadcast_id: this.broadcastId, error: error });
        };

        this.detach = function () {
            var _this = this;
            this.willDetachFromBroadcast();
            if (this._checkIfNonExistCabraSession()) {
                this.didDetachFromBroadcast();
                return true;
            }

            this._exitCabras().then(function () {
                _this.didDetachFromBroadcast();
            }, function () {
                _this.didFailToDetachFromBroadcast();
            });
        };

        this.willDetachFromBroadcast = function () {
            Logger.debug("Attempting to Detach Broadcast (" + this.broadcastId + ")");
            //pubsub.publish(broadcastEvents.BroadcastSessionWillDetachEvent, { broadcast_id: this.broadcastId });
            //TODO: normalize on pubsub
            this.emitEvent(broadcastEvents.BroadcastSessionWillDetachEvent, [{"broadcast_id": this.broadcastId}]);
            sandbox.publish(broadcastEvents.BroadcastSessionWillDetachEvent, { "broadcast_id": this.broadcastId });
        };

        this.didDetachFromBroadcast = function () {
            Logger.info("Left Broadcast (" + this.broadcastId + ")");
            //var self = this,
            //    pendingAndEnteredCabras = Object.keys(this.enteredCabras).concat(Object.keys(this.pendingCabras));
            this.unsubscribe();
            this._client.stop();
            //pendingAndEnteredCabras.forEach(function (cabraId) {
            //    self.leaveCabra(cabraId);
            //});
            //pubsub.publish(broadcastEvents.BroadcastSessionDidDetachEvent, { broadcast_id: this.broadcastId });
            //TODO: normalize on pubsub
            this.emitEvent(broadcastEvents.BroadcastSessionDidDetachEvent, [this.broadcastId]);
            sandbox.publish(broadcastEvents.BroadcastSessionDidDetachEvent, { "broadcast_id": this.broadcastId });
        };

        this.didFailToDetachFromBroadcast = function (error) {
            Logger.error("Failed to Detach from broadcast " + this.broadcastId, error);
            //var self = this,
            //    pendingAndEnteredCabras = Object.keys(this.enteredCabras).concat(Object.keys(this.pendingCabras));
            this.unsubscribe();
            this._client.stop();
            //pendingAndEnteredCabras.forEach(function (cabraId) {
            //    self.leaveCabra(cabraId);
            //});
            //pubsub.publish(broadcastEvents.BroadcastSessionDidFailToDetachEvent, { broadcast_id: this.broadcastId, error: error });
            this.emitEvent(broadcastEvents.BroadcastSessionDidFailToDetachEvent, [this.broadcastId]);
            sandbox.publish(broadcastEvents.BroadcastSessionDidFailToDetachEvent, { "broadcast_id": this.broadcastId });
        };

        this._checkIfNonExistCabraSession = function () {

            if (getRealObjLength(this.activeCabras) === 0 && getRealObjLength(this.pendingCabras) === 0) {
                return true;
            }

            return false;
        };

        this._cabraDidFailToEnter = function(cabra){
            if(!cabra || ! cabra.cabra_id){
                throw new Error('You are missing a required parameter: cabra_id');
            }
            Logger.error("Cabra did fail to enter broadcast" + this.broadcast_id, cabra);
            var session = this.pendingCabras[cabra.cabra_id];
            if(!!session) {
                delete this.pendingCabras[cabra.cabra_id];
            } else {
                Logger.warn("Session was not found in pendingCabras array");
            }

            this.didReceiveError(cabra.error);
        };

        /**
         * Gets info object from attach
         * and get cabraSession from CabraSessionFactory
         * @private
         */
        this._didAttachToBroadcast = function () {

            var i, length, broadcastObjects, error = false;
            if (this._broadcastInfo && isArrayFunc(this._broadcastInfo.broadcast_objects)) {
                broadcastObjects = this.addPendingObjectsAndDedupe(this._broadcastInfo.broadcast_objects, this.pendingOpenObjects);
                this.pendingOpenObjects = [];
                length = broadcastObjects.length;
                for (i = 0; i < length; i++) {
                    /**
                     * Checks if all CabraSession initialized
                     * cabra_id doesn't contain valid value
                     */
                    broadcastObjects[i].cabra_id = broadcastObjects[i].object_id;

                    if (this._createCabraFromBroadcastObject(broadcastObjects[i]) === null) {
                        error = true;
                    }
                }
            }

            return !error;
        };

        this.addPendingObjectsAndDedupe = function (broadcastObjects) {
            //dequeue all the open objects we couldn't get to
            broadcastObjects = broadcastObjects.concat(this.pendingOpenObjects);
            return _.unique(broadcastObjects, _.iteratee("object_id"));
        };

        /**
         * Create CabraSession and apply command
         * @param event
         * @param data
         * @returns {*} //NOTE: explicitly returning false means that no other subscribers will receive this message while using jquery events
               not entirely sure this is intended
         * @private
         */
        this._openObjectEventObserver = function (event, data) {
            try {
                if (data && data.cabra_id) {
                    Logger.debug(event, data);
                    var cabraId = data.cabra_id;
                    if (!this._broadcastInfo) {//we need to parse these after attach
                        var broadcastObject = this._broadcastObjectify(data.cabra_name, data.cabra_id);
                        this.pendingOpenObjects.push(broadcastObject);
                        return true;
                    } else {
                        return this._createCabraFromBroadcastObject(data);
                    }
                } else {
                    Logger.error("OpenObject empty", data);
                }
            } catch (err) {
                Logger.error(err.message, err.stack);
                $.trigger(SETTINGS.EVENTS.FATAL_ERROR, err);
                return null;
            }

            return false;
        };

        this._broadcastObjectify = function (cabraName, cabraUUID){
            return {
                object_id: cabraUUID,
                status: SETTINGS.BROADCASTSTATUS.OPEN,
                cabra_name: cabraName
            };
        };

        /**
         * Create a cabra for a broadcast.
         * Precondition: this._broadcastInfo is not null
         * @param {object} broadcastObject The information needed for the cabra.
         * @returns {boolean|null} If creation of the cabra was successful.
         */
        this._createCabraFromBroadcastObject = function (broadcastObject) {
            if (!this._broadcastInfo) {
                throw new SystemError("Cannot call createCabraFromBroadcastObject before broadcastInfo is loaded");
            }

            // Shortcut if this cabra has already opened.
            // This is a success case since we do not need to do any more work.
            if (this.pendingCabras[broadcastObject.cabra_id] || this.activeCabras[broadcastObject.cabra_id]) {
                Logger.info("Ignoring cabra", broadcastObject.cabra_name + " already pending/active - " + broadcastObject.cabra_id);
                return true;
            }

            var filteredSupportedCabra = this._broadcastInfo.supported_cabras.filter(function(supported) {
                return supported.cabra.name === broadcastObject.cabra_name;
            })[0];

            try {
                if (filteredSupportedCabra && typeof filteredSupportedCabra === "object") {

                    var cabraSession = CabraSessionFactory.getCabraSession(
                        broadcastObject.cabra_name,
                        broadcastObject.cabra_id,
                        filteredSupportedCabra.cabra_rules,
                        this._client
                    );

                    if (cabraSession instanceof CabraSession) {
                        cabraSession.broadcastId = this.broadcastId;
                        cabraSession.course = this.roster;
                        this.pendingCabras[ broadcastObject.cabra_id ] = cabraSession;
                        this.pendingCabras[ broadcastObject.cabra_id ].once(cabraEvents.CabraSessionDidEnterEvent, this._moveCabraFromPendingToActive.bind(this));
                        this.pendingCabras[ broadcastObject.cabra_id ].once(cabraEvents.CabraSessionDidFailToEnterEvent, this._cabraDidFailToEnter.bind(this));
                        this.pendingCabras[ broadcastObject.cabra_id ].enter();
                        return true;
                    }
                }

                Logger.error("Unsupported cabra", broadcastObject.cabra_name + " not supported !");

                return false;

            } catch (e) {
                Logger.error(e.message, e.stack);
                return null;
            }
        };

        this._moveCabraFromPendingToActive = function (cabraId) {

            if (this.pendingCabras[cabraId]) {
                this.activeCabras[cabraId] = this.pendingCabras[cabraId];
                delete this.pendingCabras[cabraId];
                Logger.debug("CabraSession with id - " + cabraId + " move to active.");
                this.activeCabras[cabraId].off(cabraEvents.CabraSessionDidEnterEvent, this._moveCabraFromPendingToActive);
                return this.activeCabras[cabraId];
            }

            throw new SystemError("CabraSession with id - " + cabraId + " doesn't exist at pendingCabras !");

        };

        /**
         * Exit from all cabras.
         * @returns {Promise} A promise for leaving all cabras.
         */
        this._exitCabras = function() {
            var _this = this;
            return new Promise(function(resolve, reject) {
                try {
                    var cabras = _this._allCabras();
                    var length = getRealObjLength(cabras);
                    var count = 0;

                    // Guard against having no cabras.
                    if (length === 0) {
                        resolve();
                        return;
                    }

                    $.each(cabras, function(cabraId, cabra) {
                        cabra.once(
                            cabraEvents.CabraSessionDidLeaveEvent,
                            function(id) {
                                delete _this.activeCabras[id];
                                delete _this.pendingCabras[id];
                                Logger.debug(id + " was successfully delete from active cabras.");

                                count += 1;
                                // Resolve once all left from all cabras.
                                if (count === length) { resolve(); }
                            }
                        ).once(
                            cabraEvents.CabraSessionDidFailToLeaveEvent,
                            function(id) {
                                // Fail the promise if a cabra failed to leave.
                                reject();
                            }
                        ).leave();
                    });
                } catch (e) {
                    reject();
                }
            });
        };

        /**
         * Get the union of all active and pending cabras.
         * @returns {Session[]} An array of cabra sessions.
         */
        this._allCabras = function() {
            return $.extend({}, this.activeCabras, this.pendingCabras);
        };

        /**
         *
         * @param event
         * @param data
         * @returns {*}
         * @private
         */
        this._broadcastEndEventObserver = function (event, data) {
            this.detach();
        };

        this.subscribe = function () {
            this.boundEventHelper("on", this.broadcastId + "/" + SETTINGS.EVENTS.BROADCAST_END, this._broadcastEndEventObserver);
            this.boundEventHelper("on", this.broadcastId + "/" + SETTINGS.EVENTS.OPEN_OBJECT, this._openObjectEventObserver);
        };

        this.unsubscribe = function () {
            this.boundEventHelper("off", this.broadcastId + "/" + SETTINGS.EVENTS.OPEN_OBJECT);
            this.boundEventHelper("off", this.broadcastId + "/" + SETTINGS.EVENTS.BROADCAST_END);
        };

        this.boundEventHelper = function (eventMethod, name, func) {
            var internal = "_bound" + name;
            if (!this[internal]){
                this[internal] = func.bind(this);
            }
            $[eventMethod](name, this[internal]);
        };
    };


    window.extend(BroadcastSession, EventEmitter);

    return BroadcastSession;
});