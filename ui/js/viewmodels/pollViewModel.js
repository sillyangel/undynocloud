define(['amd/lib/knockout', 'amd/sandbox'], function(ko, Sandbox){
    var PollViewModel = function() {
        var _this = this;
        var sandbox = new Sandbox().init();
        this.polls = ko.observableArray();
        //visible may not be necessary since we will be hiding and showing it via chromebooks built in api stuff..but nonetheless could be subscribed to make those changes.
        //also custom chromebook bindingHandlers could be bound to.
        this.loaded = ko.observable(false);
        this.activePoll = ko.observable();
        this.showMask = ko.observable(false);
        this.submitAnswer = function(){
            var poll = this.activePoll();
            if(poll.selectedAnswer()){
                _this.showMask(true);
                sandbox.publish('pollAnswered', { answer: poll.selectedAnswer(), conversation_id: poll.conversation_id});
                _this.polls.push(poll);

                setTimeout(function(){
                    _this.showMask(false);
                    window.close();
                },500);

                //if we wanted to persist a sessions polls to the user, we would write to localStorage here so we could
                //pull the polls out in the student initiated view.
            }
        };
        this.isSelected = function(answer){
            return _this.activePoll().selectedAnswer() === answer;
        };
        this.selectAnswer = function(answer){
            _this.activePoll().selectedAnswer(answer);
        };
    };

    return PollViewModel;
});