define([
    'amd/clients/core', 'amd/settings', 'amd/logger/logger',
    'amd/broadcast/session', 'amd/broadcast/broadcastSession.events', 'amd/lib/EventEmitter',
    'amd/utils/featureFlags', 'amd/utils/extensionRestarter'
], function(
    CoreApiClient, SETTINGS, Logger,
    BroadcastSession, broadcastEvents, EventEmitter,
    FeatureFlags, restarter
) {
    var BroadcastSessionManager = function () {

        var _this = this;

        this._client = false;
        this.attachedSessions = [];
        this.pendingSessions = [];
        this.pendingControlChange = [];
        this.online = window.navigator.onLine;
        this.lastReportedCoreState = -1;      //used to help make sure signalr is healthy
        this.healthySignalrWatcher = false;   //makes sure that after signalr is healthy

        /**
         * Initialize the broadcast session manager.
         */
        this.init = function(accessToken, apiClient) {
            this._client = (apiClient)? apiClient : new CoreApiClient();
            this._client.accessToken = accessToken;
            this.subscribe();
            this._initializeClient();
            this.watchForHealthySignalR();
            return this;
        };

        /**
         * Initialize the client.
         */
        this._initializeClient = function() {
            if (!this._client) {
                throw new SystemError('No client available to initialize.');
            }
            this._client.initHubConnection();
        };

        /**
         * Stop all, unsubscribe from all
         */
        this.stop = function () {
            $.on(SETTINGS.EVENTS.CORE_CLIENT_STOPS, _this.coreClientStopsObserver);
            _this._client.stop();
        };

        this.coreClientStopsObserver = function () {
            $.off(SETTINGS.EVENTS.CORE_CLIENT_STOPS,_this.coreClientStopsObserver);
            _this.unsubscribe();
        };

        this.joinEventObserver = function (event, broadcastInstructions) {
            
            //Hack to work around $.trigger not sending arrays as params
            var args = (arguments.length === 1 ? [arguments[0]] : Array.apply(null, arguments));
            broadcastInstructions = args.slice(1, args.length);
            Logger.info("Switchboard Join Event Received", broadcastInstructions);
            broadcastInstructions.forEach(function (broadcastInstruction) {
                var session = _this.sessionify(broadcastInstruction);
                if(_this.isStealing()) {
                    Logger.warn("A Request to Join a Session arrived while stealing is occurring.");
                    Logger.info("We will Queue this up on the pendingControlChange list so we can handle it when the detach phase of stealing is done");
                    var broadcastId = broadcastInstruction.broadcast_id;
                    var hasPendingControlChangeSession = (broadcastId in _this.pendingControlChange);
                    if (!hasPendingControlChangeSession) {
                        _this.pendingControlChange[broadcastId] = session;
                    } else {
                        Logger.warn("Ignoring Session already pendingControlChange", broadcastId);
                        Logger.debug("PendingControlChange Sessions",Object.keys(_this.pendingControlChange).join(","));
                    }
                } else {
                    _this.maybeAttach(session, true);
                }
            });
        };

        this.leaveEventObserver = function (event, broadcastInstructions) {
            //Hack to work around $.trigger not sending arrays as params
            var args = (arguments.length === 1 ? [arguments[0]] : Array.apply(null, arguments));
            broadcastInstructions = args.slice(1, args.length);
            Logger.info("Switchboard Leave Event Received", broadcastInstructions);
            broadcastInstructions.forEach(function (broadcastInstruction) {
                if (_this.isStealing()) {
                    //Just incase we have a detach occur while a steal is in process
                    var session = _this.pendingControlChange[broadcastInstruction.broadcast_id];
                    if (!!session) {
                        delete _this.pendingControlChange[session.broadcastId];
                    }
                }
                _this.detach(broadcastInstruction.broadcast_id);
            });
        };

        this.controlChangedEventObserver = function (event, broadcastInstructions) {
            //Hack to work around $.trigger not sending arrays as params
            var args = (arguments.length === 1 ? [arguments[0]] : Array.apply(null, arguments));
            broadcastInstructions = args.slice(1, args.length);
            Logger.info("Switchboard Steal Event Received", broadcastInstructions);
            if(!_this.hasPending() && !_this.isAttached()) {
                Logger.info("Somehow, we received a Control Change Event and we were never previously connected to a session.  Possible in theory, but not probable");
                Logger.info("In Any Event, we can treat this as a simple 'Join' and avoid any of the unnecessary hoops that stealing normally includes");
                broadcastInstructions.forEach(function (broadcastInstruction) {
                    var session = _this.sessionify(broadcastInstruction);
                    _this.maybeAttach(session, true);
                });
            } else if (!_this.isStealing()) {
                broadcastInstructions.forEach(function (broadcastInstruction) {
                    var session = _this.sessionify(broadcastInstruction);
                    var broadcastId = broadcastInstruction.broadcast_id;
                    var hasPendingControlChangeSession = (broadcastId in _this.pendingControlChange);
                    if (!hasPendingControlChangeSession) {
                        _this.pendingControlChange[broadcastId] = session;
                    } else {
                        Logger.warn("Ignoring Session already pendingControlChange", broadcastId);
                        Logger.debug("PendingControlChange Sessions",Object.keys(_this.pendingControlChange).join(","));
                    }
                });
                _this.detachAll();
            }
        };

        this.leaveFromAllObserver = function (  ) {
            Logger.info("Switchboard Leaving All");
            _this.detachAll();
        };

        this.fatalErrorOccurredEventObserver = function (event, error){
            Logger.error("Fatal Error", error);
            _this.didReceiveError(error);
        };

        this.networkConnectionObserver = function(event){
            var cameOnline = !this.online && window.navigator.onLine,
                wentOffline = this.online && !window.navigator.onLine;

            this.online = window.navigator.onLine;

            if(cameOnline){
                Logger.debug('Came back online');
            } else if(wentOffline){
                Logger.debug('Went offline');
            }
        };

        this.sessionify = function (broadcastInstruction) {
            var session = new BroadcastSession(this._client.accessToken);
            session.init(broadcastInstruction);
            return session;
        };

        this.isAttached = function () {
            return (Object.keys(_this.attachedSessions).length > 0);
        };

        this.hasPending = function () {
            return (Object.keys(_this.pendingSessions).length > 0);
        };

        this.isStealing = function () {
            return (Object.keys(_this.pendingControlChange).length > 0);
        };

        this.subscribe = function() {
            $.on( SETTINGS.EVENTS.FATAL_ERROR, _this.fatalErrorOccurredEventObserver);
            $(window).on('online', _this.networkConnectionObserver);
            $(window).on('offline', _this.networkConnectionObserver);
            $.on( this._client.events.JOIN_EVENT,  _this.joinEventObserver );
            $.on( this._client.events.LEAVE_EVENT, _this.leaveEventObserver);
            $.on( this._client.events.LEAVE_FROM_ALL, _this.leaveFromAllObserver);
            $.on( this._client.events.CONTROL_CHANGED_EVENT, _this.controlChangedEventObserver);
            $.on( SETTINGS.EVENTS.CORE_CLIENT_STATE_CHANGED, _this.coreClientStateChangeObserver);
            $.on(broadcastEvents.BroadcastSessionDidReceiveErrorEvent, _this.broadcastDidReceiveError);
        };

        this.unsubscribe = function() {
            $.off( SETTINGS.EVENTS.FATAL_ERROR, _this.fatalErrorOccurredEventObserver);
            $(window).off(SETTINGS.EVENTS.OFFLINE, function(e){_this.networkConnectionObserver(e, 'online');});
            $(window).off(SETTINGS.EVENTS.ONLINE, function(e){_this.networkConnectionObserver(e, 'offline');});
            $.off( this._client.events.JOIN_EVENT,  _this.joinEventObserver );
            $.off( this._client.events.LEAVE_EVENT, _this.leaveEventObserver);
            $.off( this._client.events.LEAVE_FROM_ALL, _this.leaveFromAllObserver);
            $.off( this._client.events.CONTROL_CHANGED_EVENT, _this.controlChangedEventObserver);
            $.off( SETTINGS.EVENTS.CORE_CLIENT_STATE_CHANGED, _this.coreClientStateChangeObserver);
            $.off(broadcastEvents.BroadcastSessionDidReceiveErrorEvent, _this.broadcastDidReceiveError);
        };

        this.maybeAttach = function (session, attachImmediately) {
            var broadcastId = session.broadcastId;
            var hasAttachedSession = (broadcastId in _this.attachedSessions);
            var isAttachingSession = (broadcastId in _this.pendingSessions);
            if (!hasAttachedSession && !isAttachingSession) {
                _this.pendingSessions[broadcastId] = session;
                if (attachImmediately) {
                    _this.attach(broadcastId);
                } else {
                    Logger.warn("Attach to session is delayed", broadcastId);
                }
                return true;
            } else {
                Logger.warn("Ignoring Session", broadcastId);
                Logger.debug("Pending Sessions",Object.keys(_this.pendingSessions).join(","));
                Logger.debug("Attached Sessions",Object.keys(_this.attachedSessions).join(","));
            }
            return false;
        };

        this.attachAll = function () {
            Logger.info("Will Attach to all pending Sessions");
            Object.keys(_this.pendingSessions).forEach(function(broadcastId) {
                _this.attach(broadcastId);
            });
        };

        this.attach = function (broadcastId) {
            var session = _this.pendingSessions[broadcastId];
            if (!!session) {
                //TODO: this should be evented out by the broadcastSession but whatev for now
                _this.broadcastWillAttach(null, { "broadcast_id": broadcastId });
                session.attach().then(function(){
                    Logger.debug("Init successful of new broadcastSession with id - " + broadcastId);
                    //TODO: this should be evented out by the broadcastSession but whatev for now
                    _this.broadcastDidAttach(null, { "broadcast_id" : broadcastId});
                }, function(err) {
                    Logger.error(err);
                    //TODO: this should be evented out by the broadcastSession but whatev for now
                    //TODO: pass the error in the event
                    _this.broadcastDidFailToAttach(null, { "broadcast_id" : broadcastId});
                });
            } else {
                Logger.warn("Session was not found in pendingSessions array");
            }
        };

        this.didReceiveError = function (error) {
           Logger.error("Switchboard did receive error: " + (error || ""));
           if (error && error.context && (error.context.status === 401 || error.context.status === 403)) {
                //NOTE: idn.js depends on this event. If you move this to sandbox
                //be sure that you change the handler there as well
                $.trigger(SETTINGS.EVENTS.IDENTITY_INVALID);
            } else if (error && error.error_code === 4908) {
                Logger.info('Switchboard error 4908, triggering quick restart.');
                _this._client.restart(true);
            } else {
                _this._client.restart();
            }
        };

        this.detachAll = function () {
            if (!_this.hasPending() && !_this.isAttached()) {
                _this.didDetachFromAllBroadcast();
            } else {
                var pendingAndAttachedSessions = Object.keys(_this.attachedSessions).concat(Object.keys(_this.pendingSessions));
                pendingAndAttachedSessions.forEach(function (broadcastId) {
                    _this.detach(broadcastId);
                });
            }
        };

        this.detach = function(broadcastId) {
            var pending = _this.pendingSessions[broadcastId],
                attached = _this.attachedSessions[broadcastId],
                session = (!!pending) ? pending : (!!attached) ? attached : false;
            if (!!session) {
                //TODO: this should be evented out by the broadcastSession but whatev for now
                _this.broadcastWillDetach(null, { "broadcast_id": broadcastId });
                session.once(broadcastEvents.BroadcastSessionDidDetachEvent, function (id) {
                    //TODO: this should be evented out by the broadcastSession but whatev for now
                    _this.broadcastDidDetach(null, { "broadcast_id": id});
                }).once(broadcastEvents.BroadcastSessionDidFailToDetachEvent, function (id) {
                    //TODO: this should be evented out by the broadcastSession but whatev for now
                    _this.broadcastDidFailToDetach(null, { "broadcast_id": id});
                }).detach();
            } else {
                Logger.warn("Session was not found in pendingAndAttachedSessions array");
            }
        };

        this.didDetachFromAllBroadcast = function() {
            if (!_this.hasPending() && !_this.isAttached()) {
                Logger.debug("Processed leave command successfully !");
                //Used for stoping and restarting switchboard.  It noops if stop or restart is not called previously
                //Basically this is trying to be a promise (shrug)
                $.trigger(SETTINGS.EVENTS.DID_DETACH_FROM_ALL_BROADCAST);
                if (_this.isStealing()) {
                    Object.keys(_this.pendingControlChange).forEach(function (broadcastId) {
                        var session = _this.pendingControlChange[broadcastId];
                        if (session) {
                            _this.maybeAttach(session, false);
                            delete _this.pendingControlChange[broadcastId];
                        }
                    });
                    //At this point isStealing will return FALSE, we are ok with this since as far as the code flow is concerned
                    //The we are simply reattaching as if we are starting from scratch anyway.
                    _this.attachAll();
                }
            }
        };

        this.broadcastWillAttach = function (event, broadcast) {
            if (!broadcast || !broadcast.broadcast_id) {
                throw new Error("You are missing a required parameter: broadcast_id");
            }
            Logger.debug("Switchboard Will Attach Broadcast", broadcast);
            //pubsub.publish(switchboardEvents.BroadcastSessionManagerWillAttachToBroadcast, { broadcast_id: broadcast.broadcast_id});
        };

        this.broadcastDidAttach = function (event, broadcast) {
            if (!broadcast || !broadcast.broadcast_id) {
                throw new Error("You are missing a required parameter: broadcast_id");
            }
            Logger.info("Switchboard Did Attach Broadcast", broadcast);
            var session = _this.pendingSessions[broadcast.broadcast_id];
            if (!!session) {
                delete _this.pendingSessions[session.broadcastId];
                _this.attachedSessions[session.broadcastId] = session;
            } else {
                Logger.warn("Session was not found in pendingSessions array");
            }
            //pubsub.publish(switchboardEvents.BroadcastSessionManagerDidAttachToBroadcast, { broadcast_id: broadcast.broadcast_id });
        };

        this.broadcastDidFailToAttach = function (event, broadcast) {
            if (!broadcast || !broadcast.broadcast_id) {
                throw new Error("You are missing a required parameter: broadcast_id");
            }
            Logger.error("Switchboard Did Fail to Attach Broadcast", broadcast);
            var session = _this.pendingSessions[broadcast.broadcast_id];
            if (!!session) {
                delete _this.pendingSessions[session.broadcastId];
            } else {
                Logger.warn("Session was not found in pendingSessions array");
            }

            _this._client._processDisconnect = true;//we always need to process failure to attach errors
            _this.didReceiveError(broadcast.error);
        };

        this.broadcastDidReceiveError = function (event, broadcast) {
            //TODO: This code path is not used yet but should be

            if (!broadcast || !broadcast.broadcast_id) {
                throw new Error("You are missing a required parameter: broadcast_id");
            }
            Logger.error("Switchboard Broadcast did Error", broadcast);
            _this.didReceiveError(broadcast.error);
        };

        this.broadcastWillDetach = function (event, broadcast) {
            if (!broadcast || !broadcast.broadcast_id) {
                throw new Error("You are missing a required parameter: broadcast_id");
            }
            Logger.debug("Switchboard Will Detach Broadcast", broadcast);
            //pubsub.publish(switchboardEvents.BroadcastSessionManagerWillDetachFromBroadcast, { broadcast_id: broadcast.broadcast_id });
        };

        this.broadcastDidDetach = function (event, broadcast) {
            if (!broadcast || !broadcast.broadcast_id) {
                throw new Error("You are missing a required parameter: broadcast_id");
            }
            Logger.info("Switchboard Did Detach Broadcast", broadcast);
            var pending = _this.pendingSessions[broadcast.broadcast_id],
                attached = _this.attachedSessions[broadcast.broadcast_id];

            if (!!pending) {
                delete _this.pendingSessions[pending.broadcastId];
            }
            if (!!attached) {
                delete _this.attachedSessions[attached.broadcastId];
            }

            if (!_this.hasPending() && !_this.isAttached()) {
                _this.didDetachFromAllBroadcast();
            }
        };

        this.broadcastDidFailToDetach = function (event, broadcast) {
            if (!broadcast || !broadcast.broadcast_id) {
                throw new Error("You are missing a required parameter: broadcast_id");
            }
            Logger.error("Switchboard Did Fail to Detach Broadcast", broadcast);
            _this.broadcastDidDetach(event, broadcast);
        };

        //listen for signalr state changes from core. we are specifically interested
        //in these changes after signalr calls Stop(). we have seen instances where this
        //happens but signalr never tries to reconnect.
        this.coreClientStateChangeObserver = function(event, newState) {
            //check to see if we are something other then
            if (newState !== 4) {
                _this.lastReportedCoreState = newState;
            }
        };

        /**
         * Check if the core client is currently communicating.
         * @return {boolean} If the client is currently communicating.
         */
        this.isCommunicating = function() {
            var client = _this._client;
            if (!client) {
                Logger.error('not communicating, core client not setup when expected');
                return false;
            } else if (!client._processDisconnect) {
                Logger.warn('not communicating, processing a disconnect');
                return false;
            }
            return client.isCommunicating && client.isCommunicating();
        };

        this.didFailSignalrHealthCheck = function() {
            Logger.debug('SignalR heartbeat did not report that we were healthy for 2 minutes. Calling runtime.reload()');
            restarter.restart();
        };

        //some very weird behavior from our version of 
        //jasmine. this makes it consistent so we can mock
        this._setInterval = function (func, time) {
            return setInterval(func, time);
        };

        //Signalr heartbeat
        this.watchForHealthySignalR = function() {
            var timeout = 0;
            _this.healthySignalrWatcher = _this._setInterval( function() {
                if(!_this._client._processingDelay && (_this._client._hubConnection.state === 4  ||
                    (_this._client._hubConnection.state === 1 && !_this._client._hubConnection.groupsToken)//if for some reason we were not sent a groupsToken, we need to reset ourselves
                    ) ) {
                    if(_this.lastReportedCoreState === -1 || _this.lastReportedCoreState === 4 ) {
                        //SignalR is not connected and has not attempted to reconnect since
                        //the last check.
                        if( timeout++ > 240) {    //240 = 2 minutes
                            //Signalr is not connected and has not tried to
                            //connect in over two minutes.
                            clearInterval(_this.healthySignalrWatcher);
                            _this.healthySignalrWatcher = false;
                            _this.didFailSignalrHealthCheck();
                        }
                    } else {
                        //Signalr is currently disconnected but we've
                        //tried reconnecting in the last two minutes
                        timeout = 0;
                        _this.lastReportedCoreState = -1;
                    }
                } else {
                    //Signalr is currently either connected or trying to connect
                    timeout = 0;
                    _this.lastReportedCoreState = -1;
                }
            }, 500);
        };
    };

    extend( BroadcastSessionManager, EventEmitter );

    return BroadcastSessionManager;
});