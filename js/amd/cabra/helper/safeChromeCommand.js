define([
    "underscore"
], function (
    _
) {
    var ERRTABDRAG = "Tabs cannot be edited right now (user may be dragging a tab).";
    var safeChrome = {
        tabs: {
            get: function (tabId, callback){
                chrome.tabs.get(tabId, function(tab){
                    if(chrome.runtime.lastError && chrome.runtime.lastError.message === ERRTABDRAG){
                        _.delay(function (){
                            safeChrome.tabs.get(tabId, callback);
                        }, 200);//we want this to be pretty quick after they let up
                    } else {
                        callback(tab);
                    }    
                });
            },
            remove: function (tabId, callback){
                chrome.tabs.remove(tabId, function (){
                    if(chrome.runtime.lastError && chrome.runtime.lastError.message === ERRTABDRAG){
                        _.delay(function (){
                            safeChrome.tabs.remove(tabId, callback);
                        }, 200);//we want this to be pretty quick after they let up
                    } else if (callback) {
                        callback();
                    }
                });
            },
            update: function (tabId, queryArgs, callback){
                chrome.tabs.update(tabId, queryArgs, function () {
                    if(chrome.runtime.lastError && chrome.runtime.lastError.message === ERRTABDRAG){
                        _.delay(function (){
                            safeChrome.tabs.update(tabId, queryArgs, callback);
                        }, 200);//we want this to be pretty quick after they let up
                    } else if (callback) {
                        callback();
                    }
                });
            },
            query: function (queryArgs, callback){
                chrome.tabs.query(queryArgs, function (tabs){
                    if(chrome.runtime.lastError && chrome.runtime.lastError.message === ERRTABDRAG){
                        _.delay(function (){
                            safeChrome.tabs.query(queryArgs, callback);
                        }, 200);//we want this to be pretty quick after they let up
                    } else {
                        callback(tabs);
                    }
                });
            },
            discard: function (tabId, callback){
                chrome.tabs.discard(tabId, function (){
                    if(chrome.runtime.lastError && chrome.runtime.lastError.message === ERRTABDRAG){
                        _.delay(function (){
                            safeChrome.tabs.discard(tabId, callback);
                        }, 200);//we want this to be pretty quick after they let up
                    } else if (callback) {
                        callback();
                    }
                });
            }
        }, 
        windows: {
            get: function (windowId, queryArgs, callback){
                chrome.windows.get(windowId, queryArgs, function (win){
                    if(chrome.runtime.lastError && chrome.runtime.lastError.message === ERRTABDRAG){
                        _.delay(function (){
                            safeChrome.windows.get(windowId, queryArgs, callback);
                        }, 200);//we want this to be pretty quick after they let up
                    } else {
                        callback(win);
                    }
                });
            }, 
            getAll: function (queryArgs, callback){
                chrome.windows.getAll(queryArgs, function (windows){
                    if(chrome.runtime.lastError && chrome.runtime.lastError.message === ERRTABDRAG){
                        _.delay(function (){
                            safeChrome.windows.getAll(queryArgs, callback);
                        }, 200);//we want this to be pretty quick after they let up
                    } else {
                        callback(windows);
                    }
                });
            }, 
            update: function (windowId, queryArgs, callback){
                chrome.windows.update(windowId, queryArgs, function (){
                    if(chrome.runtime.lastError && chrome.runtime.lastError.message === ERRTABDRAG){
                        _.delay(function (){
                            safeChrome.windows.update(windowId, queryArgs, callback);
                        }, 200);//we want this to be pretty quick after they let up
                    } else if (callback) {
                        callback();
                    }
                });
            }
        }
    };
    return safeChrome;
});