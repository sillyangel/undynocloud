define(['amd/logger/logger', 'amd/lib/promise-queue/promise-queue'], function (Logger, Queue) {
    var 
    _watchInterval = false,
    _watchInterval_open = false,
    keepAliveManager = {
        priority: {
            required: "required",
            high: "high",
            low: "low"
        },
        promiseQueue:  new Queue(1),

        keepAliveHeartbeat: function () {
            Logger.debug('WindowKeepAliveHeartbeat');
            if (keepAliveManager.keepAlives.length > 0) {
                var keepAlive = keepAliveManager.keepAlives[0];
                Logger.debug("Will Add Promise to Promise Queue");
                Logger.debug("KeepAlive Queue", keepAliveManager.promiseQueue.getQueueLength());
                keepAliveManager.promiseQueue.add(function () { 
                    return new Promise(function (resolve, reject) {
                        keepAlive.checkCondition().then(function() {
                            Logger.debug('Watched window is still Focused');
                            return keepAlive.shouldKeepAlive().then(resolve, function () {
                                return keepAlive.close().then(resolve, reject);
                            });
                        }, function () {
                            Logger.warn('Watched window lost focus');
                            return keepAlive.shouldKeepAlive().then(function() {
                                return keepAlive.resolution().then(resolve, reject);
                            }, function () {
                                return keepAlive.close().then(resolve, reject);
                            });
                        });
                    });
                });
                Logger.debug("Did Add Promise to Promise Queue");
                Logger.debug("KeepAlive Queue", keepAliveManager.promiseQueue.getQueueLength());
            }
        },
        keepAlives: [],
        sortKeepAliveByPriority: function () {
            keepAliveManager.keepAlives.sort(function (a, b) {
                var sort = {
                    aBeforeB: -1,
                    aAfterB: 1,
                    same: 0
                };
                if ((a.priority == keepAliveManager.priority.required && b.priority == keepAliveManager.priority.required) ||
                    (a.priority == keepAliveManager.priority.high && b.priority == keepAliveManager.priority.high) ||
                    (a.priority == keepAliveManager.priority.low && b.priority == keepAliveManager.priority.low)) {
                    return sort.same;
                } else if ((a.priority == keepAliveManager.priority.required && b.priority == keepAliveManager.priority.high) ||
                           (a.priority == keepAliveManager.priority.required && b.priority == keepAliveManager.priority.low) ||
                           (a.priority == keepAliveManager.priority.high && b.priority == keepAliveManager.priority.low)) {
                    return sort.aBeforeB;
                } else if ((a.priority == keepAliveManager.priority.high && b.priority == keepAliveManager.priority.required) ||
                           (a.priority == keepAliveManager.priority.low && b.priority == keepAliveManager.priority.required) ||
                           (a.priority == keepAliveManager.priority.low && b.priority == keepAliveManager.priority.high)){
                    return sort.aAfterB;
                }
                return sort.same;
            });
        },
        addKeepAlive: function (keepAlive, priority) {
            if (!priority){
                priority = keepAliveManager.priority.high;
            }
            keepAlive.priority = priority;
            return new Promise(function (resolve, reject) {
                keepAliveManager.keepAlives.push(keepAlive);
                keepAliveManager.sortKeepAliveByPriority();
                keepAlive.subscribe();
                keepAlive.shouldKeepAlive().then(function() {
                    Logger.info('windowKeepAliveManager','shouldKeepAlive called success');
                    keepAlive.open().then(resolve, reject);
                }, resolve);
            });
        },
        removeKeepAlive: function (keepAlive) {
            return new Promise(function (resolve, reject) {
                var index = keepAliveManager.keepAlives.indexOf(keepAlive);
                if (index !== -1) {
                    keepAliveManager.keepAlives.splice(index, 1);
                    keepAliveManager.sortKeepAliveByPriority();
                    keepAlive.unsubscribe();
                    keepAlive.close().then(resolve, reject);
                } else {
                    reject();
                }
            });
        }
    };
    
    _watchInterval = setInterval(keepAliveManager.keepAliveHeartbeat.bind(keepAliveManager), 500);
    
    return keepAliveManager;
});