define([], function(){
    var restarter = {
        callbacks: [],
        _resetForTests: function () {
            this.callbacks = [];
        },
        addBeforeShutdownCallback: function (callback){
            this.callbacks.push(callback);
        },
        restart: function () {
            if (!this.callbacks.length) {
                chrome.runtime.reload();
            } else {
                var promises = this.callbacks.map(function (cb){
                    var ret = cb();
                    if (ret && ret.then){
                        return ret;
                    } else {
                        return $.Deferred().resolve();
                    }
                });
                Promise.all(promises).then(function (){
                    chrome.runtime.reload();//when we're happy
                }, function(){
                    chrome.runtime.reload();//when we're sad
                });
            }

        }
    };
    return restarter;
});