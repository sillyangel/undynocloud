require.config({
    paths: {
        underscore: "../js/amd/lib/underscore",
        linkify: "../js/amd/lib/linkify.amd",
        amd: "../js/amd",
        viewmodels: "../ui/js/viewmodels",
        js: "../js"
    }
});


define(['js/globals','amd/filesystem', 'amd/application', 'amd/clients/logsender','amd/urlAckPurger'], function(ignore, filesystem, App, LogSenderClient, AckPurger){
    var app = new App();




//this is a hack to force signalr to use SSE
    $.signalR.fn.isCrossDomain = function(){ return false; };
    
    $.signalR.fn._oldparseResponse = $.signalR.fn._parseResponse;
    $.signalR.fn._parseResponse = function (response) {
        this.log("OnMessage: " + response);
        return this._oldparseResponse(response);  
    };
    
    filesystem.init()
        .then(app.start, function(){
            console.log('filesystemFailed to start');
        });
    AckPurger.purgeOldAckEntries()
        .then(function(){
            console.log('purged old url ack files')
        });
    
    var LogSender = new LogSenderClient(),
        openWindowId = null;


    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        Object.keys(request).forEach(function(topic){
            switch (topic) {
                case 'sendlogs':
                    var options = request[topic].options,
                        startDate = new Date(request[topic].startDate),
                        endDate = new Date(request[topic].endDate);

                    LogSender.sendLogsWithStartDate(startDate, endDate, options)
                        .done(function(){
                            sendResponse({});
                        })
                        .fail(function(error){
                            sendResponse({error:error});
                        });
                    break;
            }
        });
        // Return true to indicate that the response will be sent asynchronously.
        return true;
    });

    LogSender.on({'statusUpdate': function(e, status){
        var message = {
            "updateLogStatus": {
                "total": status.total,
                "current": status.current,
                "message": status.message
            }
        };
        chrome.runtime.sendMessage(message);
    }});



    $(window).on('showPoll', function(question){
        var success = function() {
                sendMessage('question',question);
            },
            failure = function() {
                chrome.windows.create({
                    "url": chrome.extension.getURL("../ui/views/cabras/statusRequest.html"),
                    "type": "popup",
                    "height": 300,
                    "width": 300
                }, function (window) {
                    openWindowId = window.id;
                    sendMessage('question',question);
                });
            };

        isWindowOpen(openWindowId)
            .then(success, failure);

    });
});



