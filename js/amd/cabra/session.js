define([
    'amd/settings', 'amd/logger/logger', 'amd/cabra/cabraSession.events',
    'amd/lib/EventEmitter', 'amd/sandbox', 'amd/../js/globals'
], function(
    SETTINGS, Logger, cabraEvents,
    EventEmitter, Sandbox, globals
) {
    //Note: bring in globals so the extend doesn't blow up in unit tests....
    var sandbox = new Sandbox().init();
    var CabraSession = function () {
        this.name = "";
        this.broadcastId = "";
        this.cabraId = "";
        this.version = 1;
        this.rules = [];
        this._client = false;
        this.state = null;
        this._subscribed = false;//allows subclasses to subscribe without fear of double subscriptions
        
        this.init = function ( name, cabraId, rules, satelliteAPIClient ) {
            this.name = name;
            this.cabraId = cabraId;
            this.rules = rules;
            this._client = satelliteAPIClient;
            return this;
        };

        this.enter = function () {
            var _this = this;
            this.willEnterCabra();
            _this._client.enterCabra(this.cabraId)
                .done(_this.didEnterCabra.bind(_this))
                .fail(_this.didFailToEnterCabra.bind(_this));
        };
        
        this.willEnterCabra = function () {
            Logger.debug("Attempting to Enter " + this.name + " (CabraUUID:" + this.cabraId + ") for Broadcast");
            //pubsub.publish(cabraEvents.CabraSessionWillEnterEvent, { cabra_id: this.cabraId, cabra_uuid: this.cabraUUID, name: this.name });
            //TODO: normalize on pubsub
            this.emitEvent(cabraEvents.CabraSessionWillEnterEvent);
            sandbox.publish(cabraEvents.CabraSessionWillEnterEvent, { "cabra_id": this.cabraId, "name": this.name });
        };
        
        this.didEnterCabra = function (cabraInfo) {
            Logger.info("Entered " + this.name + " (CabraUUID:" + this.cabraId + ") for Broadcast", cabraInfo);
            //pubsub.publish(cabraEvents.CabraSessionDidEnterEvent, { cabra_id: this.cabraId, cabra_uuid: this.cabraUUID, name: this.name });
            //TODO: normalize on pubsub
            this.emitEvent(cabraEvents.CabraSessionDidEnterEvent, [cabraInfo.broadcast_cabra_id]);
            sandbox.publish(cabraEvents.CabraSessionDidEnterEvent, { "cabra_id": this.cabraId, "name": this.name });
            if (!!cabraInfo.state) {
                Logger.info(this.name + " has State to apply", cabraInfo.state);
                this.applyFromState(cabraInfo.state);
            }
            this.subscribe();
        };
        
        this.didFailToEnterCabra = function (error) {
            Logger.error("Failed to Open Cabra" + "(CabraUUID:" + this.cabraId + ")", error);
            //pubsub.publish(cabraEvents.CabraSessionDidFailToEnterEvent, { cabra_id: this.cabraId, cabra_uuid: this.cabraUUID, name: this.name, error: error });
            //TODO: normalize on pubsub
            this.emitEvent(cabraEvents.CabraSessionDidFailToEnterEvent, [{"cabra_id": this.cabraId, "error": error}]);
            sandbox.publish(cabraEvents.CabraSessionDidFailToEnterEvent, { "cabra_id": this.cabraId, "name": this.name });
            //throw new SystemError("Error in openCabra request. Error description - " + error);
        };

        this.applyFromState = function (state) {
            Logger.info(this.name + " (CabraUUID:" + this.cabraId + ") State Applied", state);
            this.state = state;
            //TODO: normalize on pubsub
            //pubsub.publish(cabraEvents.CabraSessionApplyFromStateEvent, { cabra_id: this.cabraId, cabra_uuid: this.cabraUUID, name: this.name, frame: state });
            this.emitEvent(cabraEvents.CabraSessionStateChangeEvent,[this.cabraId]);
            sandbox.publish(this.broadcastId + "/" + cabraEvents.CabraSessionStateChangeEvent, { "cabra_id": this.cabraId, "name": this.name, frame: state });
        };
        
        this.didReceiveError = function (error) {
            Logger.error(this.name + " Cabra " + "(CabraUUID:" + this.cabraId + ") did receive error", error);
            //TODO: normalize on pubsub
            //pubsub.publish(cabraEvents.CabraSessionDidReceiveErrorEvent, { cabra_id: this.cabraId, cabra_uuid: this.cabraUUID, name: this.name, error: error });
        };

        this.applyFromRealtime = function (evt, data) {
            var frame = this._getFrame(data);
            Logger.info(this.name + " (CabraUUID:" + this.cabraId + ") Realtime Applied", frame);
            this.state = frame;
            //TODO: normalize on pubsub
            //pubsub.publish(cabraEvents.CabraSessionApplyFromRealtimeEvent, { cabra_id: this.cabraId, cabra_uuid: this.cabraUUID, name: this.name, frame: frame });
            this.emitEvent(cabraEvents.CabraSessionStateChangeEvent,[this.cabraId]);
            sandbox.publish(this.broadcastId + "/" + cabraEvents.CabraSessionStateChangeEvent, { "cabra_id": this.cabraId, "name": this.name, frame: frame });
        };
        
        this.leave = function () {
            try {
                this.willLeaveCabra();
                //TODO: this should call API endpoint for leave...
                this.didLeaveCabra();
            } catch (e) {
                this.didFailToLeaveCabra(e);
            }
        };
        
        this.willLeaveCabra = function () {
            Logger.debug("Attempting to Exit " + this.name + " (CabraID:" + this.cabraId + ")" + "(CabraUUID:" + this.cabraUUID + ") for Broadcast");
            //pubsub.publish(cabraEvents.CabraSessionWillLeaveEvent, { cabra_id: this.cabraId, cabra_uuid: this.cabraUUID, name: this.name });
            //TODO: normalize on pubsub
            this.emitEvent(cabraEvents.CabraSessionWillLeaveEvent);
            sandbox.publish(cabraEvents.CabraSessionWillLeaveEvent, { "cabra_id": this.cabraId, "name": this.name });
        };
        
        this.didLeaveCabra = function () {
            Logger.info("Left " + this.name + " (CabraID:" + this.cabraId + ")" + "(CabraUUID:" + this.cabraUUID + ") for Broadcast");
            this.unsubscribe();
            //pubsub.publish(cabraEvents.CabraSessionDidLeaveEvent, { cabra_id: this.cabraId, cabra_uuid: this.cabraUUID, name: this.name });
            //TODO: normalize on pubsub
            this.emitEvent(cabraEvents.CabraSessionDidLeaveEvent,[this.cabraId]);
            sandbox.publish(cabraEvents.CabraSessionDidLeaveEvent, { "cabra_id": this.cabraId, "name": this.name });
        };

        this.didFailToLeaveCabra = function (error) {
            Logger.error("Failed to Leave Cabra " + this.name + " (CabraID:" + this.cabraId + ")" + "(CabraUUID:" + this.cabraUUID + ") for Broadcast", error);
            this.unsubscribe();
            //pubsub.publish(cabraEvents.CabraSessionDidFailToLeaveEvent, { cabra_id: this.cabraId, cabra_uuid: this.cabraUUID, name: this.name, error: error });
            //TODO: normalize on pubsub
            this.emitEvent(cabraEvents.CabraSessionDidFailToLeaveEvent);
            sandbox.publish(cabraEvents.CabraSessionDidFailToLeaveEvent, { "cabra_id": this.cabraId, "name": this.name });
        };
        
        this._FrameCommandTypeNewObject = null;
        
        this.subscribe = function ( ) {
            if (this._subscribed){ return; }
            this._FrameCommandTypeNewObject = this.applyFromRealtime.bind(this);
            //TODO: use pubsub instead
            $.on(  this.cabraId + SETTINGS.EVENTS.NEW_OBJECT, this._FrameCommandTypeNewObject);
            this._subscribed = true;
        };

        this.unsubscribe = function () {
            this._subscribed = false;
            //TODO: use pubsub instead
            $.off(  this.cabraId + SETTINGS.EVENTS.NEW_OBJECT, this._FrameCommandTypeNewObject);
            this._FrameCommandTypeNewObject = null;
        };
        
        this._getFrame = function ( data ) {
            var broadcastObject = data.broadcastObject;
            if (broadcastObject && typeof broadcastObject === "object" && broadcastObject.payload &&
                typeof broadcastObject.payload === "object") {
                return broadcastObject.payload;
            }

            throw new SystemError("Not valid frame !");
        };
    };

    extend( CabraSession, EventEmitter );

    return CabraSession;
});