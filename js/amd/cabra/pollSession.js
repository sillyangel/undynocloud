define(['amd/cabra/session', 'amd/cabra/helper/poll', 'amd/logger/logger'], function(CabraSession, Poll, Logger){
    var PollCabraSession = function () {
        var _this = this;
        var constants = {
            payloads : {
                teacherPollRequest: "256d8517-9a0c-460b-8d6d-af3dcb4c908f",
                studentUpdateDevicePoll: '148ea40d-bd69-4492-8e22-2414829ad76e'
            }
        };

        this.poll = false;
        this.pendingPolls = {};

        this.init = function (name, cabraId, rules, satelliteAPIClient, instance) {
            this.poll = new Poll();
            return PollCabraSession.prototype.init.apply(this, arguments);
        };

        this.didEnterCabra = function (cabraInfo) {
            PollCabraSession.prototype.didEnterCabra.apply(this, arguments);
            
            this.poll.start();
            this.pendingPolls = {};
            sandbox.subscribe('pollAnswered', function(answer){
                _this.postAnswerToServer(answer);
                _this.poll.hideUI();
            });
        };

        this.willLeaveCabra = function () {
            this.poll.stop();
            sandbox.unsubscribe('pollAnswered');
            
            PollCabraSession.prototype.willLeaveCabra.apply(this, arguments);
        };

        this.applyFromState = function (data) {
            PollCabraSession.prototype.applyFromState.apply(this, arguments);
            
            //hack to give initial form a second to open (prevents opening of 3 forms
            if(data.payload){
                Logger.info("State: has pending poll, showing form");
                _this.assessmentRequest(data);
            }
        };

        this.applyFromRealtime = function (evt, data) {
            PollCabraSession.prototype.applyFromRealtime.apply(this, arguments);
            
            var payload = data.broadcastObject.payload;
            if(payload.payload_id === constants.payloads.teacherPollRequest){
                Logger.info("Realtime: New poll received showing form");
                this.assessmentRequest(payload);
            } else if(payload.payload_id === constants.payloads.studentUpdateDevicePoll){
                Logger.info("Realtime: Student responded to poll on another device, hiding form");
                this.poll.hideUI();
            }

        };

        this.postAnswerToServer = function(obj){
            if (!this.pendingPolls[obj.conversation_id]) {
                Logger.warn("Answer already sent for this question, ignoring:" +JSON.stringify(obj));
                return;
            }
            delete this.pendingPolls[obj.conversation_id];
            var our_rule = this.rules.filter(function(rule){return rule.to === 'broadcaster' && rule.from === 'participant';}).first();
            this._client.addCabraFrame(this.cabraId, our_rule, obj.conversation_id, { answer: obj.answer.answer})
                .done(function (data) {
                    Logger.debug("Answer was successfully post to the server.", obj);
                }).fail(function (error) {
                    Logger.error("Answer was post request failed.", error);
                });
        };

        this.assessmentRequest = function(payload){
            this.pendingPolls[payload.conversation_id] = true;
            this.poll.assessmentRequest(payload);
        };
    };

    extend( PollCabraSession, CabraSession );

    return PollCabraSession;
});