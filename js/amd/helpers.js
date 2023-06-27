define([], function(){
    var WindowHelper = function() {
        var _this = this;
        this.isWindowOpen = function(window_id){
            return new Promise(function(resolve, reject){
                window_id = parseInt(window_id);
                if(isNaN(window_id)){
                    reject("invalid window");
                } else {
                    try {
                        chrome.windows.get(window_id, function (window) {
                            if (window) {
                                resolve(window);
                            } else {
                                reject(chrome.runtime.lastError || "failed to get window");
                            }
                        });
                    } catch (e) {
                        reject(chrome.runtime.lastError || "failed to get window");
                    }
                }
            });
        };
        this.openFullscreen = function (url, callback) {
            var obj = {
                "url": chrome.extension.getURL(url),
                "type": "popup",
                "state": "fullscreen"
            };
            
            chrome.windows.create(obj, function(window){
                callback(window);
            });
        };
        
        this.openWindow = function(url, type, height, width, top, left, onTop ,callback){

            var obj = {
                "url": chrome.extension.getURL(url),
                "type": type,
                "top": top,
                "left": left
            };
            
            if (width) {
                obj.width = width;
            }
            
            if(height){
                obj.height = height;
            }
            chrome.windows.create(obj, function(window){
                callback(window);
            });
        };
        this.getWindow = function (windowId) {
            return new Promise(function(resolve, reject){
                windowId = parseInt(windowId,10);
                if(isNaN(windowId)){
                    reject("invalid window id");
                } else {
                    chrome.windows.get(windowId, function (window) {
                        if (window) {
                            resolve(window);
                        } else {
                            reject(chrome.runtime.lastError || "failed to get window");
                        }
                    });
                }
            });
        };
        this.closeWindow = function(windowId){
            return new Promise(function(resolve, reject){
                windowId = parseInt(windowId,10);
                if(isNaN(windowId)){
                    reject("invalid window id");
                }
                else {
                    _this.isWindowOpen(windowId)
                        .then(function (window) {
                            chrome.windows.remove(windowId, resolve);
                        }, function () {
                            console.log("Attempted to close a window that was not open " + windowId);
                            resolve();
                        });
                }
            });
        };
        this.updateWindow = function (windowId, focused, width, height, left, top) {
            var obj = {};
            if (focused) {
                obj.focused = true;
            }
            if (width) {
                obj.width = width;
            }
            if (height) {
                obj.height = height;
            }
            if (left) {
                obj.left = left;
            }
            if (top) {
                obj.top = top;
            }
            
            chrome.windows.update(windowId, obj);
        };
    };

    return WindowHelper;
});