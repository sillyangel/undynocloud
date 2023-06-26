define(['underscore','amd/logger/logger'], function(_,Logger){
    var purger = {
        
        purgeOldAckEntries : function () {
            Logger.debug('Entered purgeOldAckEntries.');
            var _this = this;
            return new Promise(function(resolve, reject){
                //get date setup
                var today = new Date(),
                    keys_to_delete = [],
                    storage = null,
                    ts = today.getTime(),
                    sevenDays = ts - (7 * 24 * 60 * 60 * 1000);

                //read everything from local storage
                today.setTime(sevenDays);
                
                chrome.storage.local.get(null,function(localStorage){
                    storage = localStorage;
                    _.each(storage,function(item, key, list) {
                        var dt = new Date(item.date);
                        if(dt.valueOf() <= today.valueOf()) {
                            keys_to_delete.push(key);
                        }
                    });
                    chrome.storage.local.remove(keys_to_delete,function(){
                       resolve(); 
                    });
                });
            });
        } 
    };
    return purger;
});