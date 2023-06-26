define([], function(){

    var Sandbox = function(){
        var _this = this;
        if(window.sandbox){
            return window.sandbox;
        }

        this.init = function(){
            if(!this.ready) {
                //note: according to https://developers.chrome.com/extensions/runtime#method-sendMessage
                //runtime sendmessage does not send to your current frame, so it's only 
                //valid outside our context
                chrome.runtime.onMessage.addListener(sandbox._processEvents);
                this.ready = true;
            }
            return this;
        };

        this.ready = false;

        this.dictionary = {};

        this.subscribe= function (event, callback) {
            if (this.dictionary[event]) {
                this.dictionary[event].push(callback);
            } else {
                this.dictionary[event] = [];
                this.dictionary[event].push(callback);
            }
        };

        this.unsubscribe = function(event, callback){
            if(event && callback){
                this.dictionary[event] = this.dictionary[event].filter(function(func){
                    return func !== callback;
                });
            } else if(event){
                delete this.dictionary[event];
            }
            $.off(event, callback);
        };

        this.publish= function (event, data, onResponse) {
            var toSend = {};
            toSend[event] = data ? data: {};
            //note: according to https://developers.chrome.com/extensions/runtime#method-sendMessage
            //runtime sendmessage does not send to your current frame, so it's only 
            //valid outside our context
            this._sendEvents(toSend, onResponse);
            //this allows the passing back and forth within the frame
            var callbacks = this.dictionary[event];
            if (callbacks && callbacks.length){
                var pubsub = this;
                callbacks.forEach(function (eventCallback){
                    //onResponse not currently supported
                    eventCallback(data);
                });
            }
        };

        this._processEvents= function (request) {
            for(var prop in request){
                if (_this.dictionary[prop]) {
                    _this.dictionary[prop].forEach(function(func){
                        func(request[prop]);
                    });
                }
            }
        };

        this._reset = function(){
            this.dictionary = {};
        };

        this._sendEvents= function (events, onResponse){
            //note: according to https://developers.chrome.com/extensions/runtime#method-sendMessage
            //runtime sendmessage does not send to your current frame, so it's only 
            //valid outside our context
            chrome.runtime.sendMessage(events, onResponse);
        };

        window.sandbox = this;
    };

    return Sandbox;
});