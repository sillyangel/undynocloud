define([
    'amd/clients/core', 'amd/logger/logger', 'amd/sandbox', 
    'underscore', 'amd/cabra/helper/pal', 'amd/lib/pako',
    'amd/clients/delaySwitchboardTracker', 'amd/logger/EnvironmentInformation' , 'amd/utils/extensionRestarter'
], function(
    CoreApiClient, Logger, Sandbox, 
    _, Pal, pako,
    delaySwitchboardTracker, EnvironmentInformation, restarter
) {
    /* now that e-learning has moved from the syncronous classroom 
    * to an async schedule, it is harder for teachers to keep track
    * of issues students are having without students having the insight
    * into their own challenges. Effectively, "walking around the room"
    * is no longer available as a teacher strategy when there's no room.
    * This feature, needs to be opt-in explicitly at the district level
    * till we have been able to verify that we have nailed down fully 
    * reliable reporting/error recovery/etc. Also need to be sure that it
    * still respects the time-based limitations enforced at the district
    * level, and finally if they are still running ip-based restrictions
    * even at home, we need to respect that (which at home would mean that
    * nobody's activity history would be tracked)
    */
    var activityCollector = {
        _run: false,
        _userDfd: null,
        _user: null,
        _resetForTest: function () {
            activityCollector._run = false;
            activityCollector._userDfd = null;
            activityCollector._user = null;
            activityCollector.pal = new Pal();
            activityCollector.api = new CoreApiClient();
            activityCollector._targetTime = null;
            activityCollector._collectionWindowTime = null;
            activityCollector._lastTime = null;
            activityCollector._lastActivity = null;
            activityCollector._uploadFails = 0;
            activityCollector.activities = [];
            activityCollector._lastBackup = null;
            activityCollector._startedUpload = false;
            activityCollector._windowTimeInMinutes = 60;
        },
        _targetTime: null,
        _collectionWindowTime:null,
        _lastTime: null,
        _lastActivity: null,
        _uploadFails: 0,
        _lastBackup: null,
        _startedUpload: false,
        activities:[],
        pal: new Pal(),
        api: new CoreApiClient(),
        info: new EnvironmentInformation(),
        start: function(){
            //in order to properly start, we need to be allowed to start 
            //(we assume that we only call start when we have )
            activityCollector._run = true;
            restarter.addBeforeShutdownCallback(function (){
               return activityCollector.backup(); 
            });
            //we have a race condition we have to deal with here
            if (!activityCollector._userDfd){
                var userResolve;
                activityCollector._userDfd = new Promise(function (resolve, reject){
                    userResolve = resolve;//capture resolve for use later
                });
                activityCollector._userDfd.resolve = userResolve;//for convenience
            }
            chrome.storage.local.get("activitycollector_cache", function (results){
                //I dont know how long this thing is gonna take, so I'd really rather
                //now have to deal with delaying if it's crazy crazy slow. maybe if
                //it takes too long we would just drop everything? 
                if (results && results.activitycollector_cache){
                    //todo: determine when we'd rather dump this data
                    //for example if it's a year old, we should dump it
                    var storedData = results.activitycollector_cache;
                    var now = _.now();
                    //need to check that the storeddata doesnt break us
                    if (!storedData.activities || !_.isArray(storedData.activities) || 
                        //falsey collectionWindowTime tells runTimer to init itself
                        (storedData.collectionWindowTime && !_.isNumber(storedData.collectionWindowTime)) ||
                        (storedData.targetTime && !_.isNumber(storedData.targetTime)) ||
                        !storedData.lastTime || !_.isNumber(storedData.lastTime)
                    ){
                        Logger.info("activityCollector - data from cache was corrupted. bailing out");
                        return;
                    } else if (storedData.lastTime <= now - (60000*60 *24* 5)){//5 days ago
                        Logger.info("activityCollector - data from cache was too old. bailing out");
                        return;
                    } else if (activityCollector._startedUpload){
                        Logger.info("activityCollector - data from cache loaded after start of first upload. bailing out");
                        return;
                    }
                    Logger.info("activityCollector - loading from cache");
                    //you might be wondering where lastActivity is? 
                    //we dont want lastActivity to be loaded bc if I restart my machine
                    //that activity may not loaded but if we plop last activity down, 
                    //it will falsely claim that it was used today
                    var newActivities = activityCollector.activities;
                    var priorLastTime = activityCollector._lastTime;
                    activityCollector.activities = storedData.activities;
                    activityCollector._lastTime = storedData.lastTime;
                    activityCollector._collectionWindowTime = storedData.collectionWindowTime;
                    activityCollector._targetTime = storedData.targetTime;
                    if (newActivities.length){
                        var then = +new Date(newActivities[0].time + "Z");
                        activityCollector.addOnlineOrOfflineActivities(
                            newActivities[0].payload_uuid === "39c4f580-5f5b-417f-8b55-b432802aa1d9",
                            then
                        );
                    }
                    activityCollector.activities = activityCollector.activities.concat(newActivities);
                    if (priorLastTime){
                        activityCollector._lastTime = priorLastTime;//restore the last time so we dont think we fell asleep
                    }
                }
            });
            activityCollector._userDfd.then(function (user){
                //begin our process doing stuff  
                activityCollector._user = user;
                activityCollector.subscribe();
                activityCollector.pal.start();
                activityCollector.runTimer();
            });
        },
        setToken: function (token){
            activityCollector.api.accessToken = token;
        },
        setUser: function (user){
            //have to have an identified/associated user before
            //we can 
            if (!activityCollector._userDfd){
                activityCollector._userDfd = Promise.resolve(user);
            } else if (activityCollector._userDfd.resolve) {
                //important to remember that all subsequent resolve
                //calls are noop's, including this one if we've not
                //reset ourselves properly 
                activityCollector._userDfd.resolve(user);
            }
        },
        subscribe: function (){
            activityCollector.pal.on("activity", activityCollector.onActivity);
        },
        unsubscribe: function(){
            activityCollector.pal.off("activity", activityCollector.onActivity);
        },
        _formatNow: function (now){
            //now expected to be a number, like _.now()
            var str = new Date(now).toISOString();
            if (str.endsWith("Z")){
                str = str.substr(0, str.length -1);
            }
            return str;
        },
        _windowTimeInMinutes: 60,
        _anchorToHour: function (now){
            var date = new Date(now);
            date.setMinutes(date.getMinutes() + activityCollector._windowTimeInMinutes, 0, 0);
            if (activityCollector._windowTimeInMinutes === 60)
            {
                date.setMinutes(0, 0, 0); // Resets also seconds and milliseconds
            } else {
                date.setMinutes(
                    Math.floor(date.getMinutes() /activityCollector._windowTimeInMinutes) * activityCollector._windowTimeInMinutes,
                    0,0);
            }
            return +date;//convert back to number
        },
        _getWindowStartFromEnd: function (windowEndTime){
            return windowEndTime - 60000 * activityCollector._windowTimeInMinutes;
        },
        _getCurrentWindowStart: function (){
            return activityCollector._getWindowStartFromEnd(
                activityCollector._collectionWindowTime
            );
        },
        _getNumberOfWindowsBetweenTimes: function (then, now){
            //prereq: now > then+30000
            var nextWindow = activityCollector._anchorToHour(now);
            var firstWindowEnd = activityCollector._anchorToHour(then);
            //window0.Start, then, window0.end, window1.start, window1.end,windowN.start, now, nextwindow
            return Math.floor((nextWindow - firstWindowEnd) / (60000*activityCollector._windowTimeInMinutes));
        },
        addOnlineOrOfflineActivities: function (fromActivity, overrideNow){
            var now = _.now();
            if(overrideNow){
                now = overrideNow;
            }
            if (now > activityCollector._lastTime + 60000*1.5){
                var then = activityCollector._lastTime + 60000;
                activityCollector.activities.push({
                    time: activityCollector._formatNow(then),
                    payload_uuid: "c4bec4c2-725b-40f9-b484-e45061e8463c",
                    payload:{
                        status: "offline"
                    }
                });
                activityCollector.activities.push({
                    time: activityCollector._formatNow(now),
                    payload_uuid: "c4bec4c2-725b-40f9-b484-e45061e8463c",
                    payload:{
                        status: "ok"
                    }
                });
                if(!fromActivity && activityCollector._lastActivity){
                    activityCollector.activities.push({
                        time: activityCollector._formatNow(now),
                        payload_uuid: "39c4f580-5f5b-417f-8b55-b432802aa1d9",
                        payload: activityCollector._lastActivity,
                        stale: "stale"//stale communicates that we dont want there to be an additional viewCount
                    });
                }                
            }
            activityCollector._lastTime = now;//if we dont do this we can doublecount
        },
        onActivity: function (activity){
            activityCollector.addOnlineOrOfflineActivities(true);
            activityCollector.activities.push({
                time: activityCollector._formatNow(_.now()),
                payload_uuid: "39c4f580-5f5b-417f-8b55-b432802aa1d9",
                payload: activity
            });
            activityCollector._lastActivity = activity;
        },
        runTimer: function () {
            var now = _.now();
            if (!activityCollector._targetTime){
                activityCollector._collectionWindowTime = activityCollector._anchorToHour(now);
                activityCollector._targetTime = activityCollector._collectionWindowTime + 60000;
                activityCollector._lastTime = now;
            }
            activityCollector.addOnlineOrOfflineActivities();
            activityCollector.backupIfNeeded();
            if (now >= activityCollector._targetTime && !delaySwitchboardTracker.delaySwitchboard){
                activityCollector._startedUpload = true;//note we never reset this
                var oldWindowTime = activityCollector._collectionWindowTime;
                var oldTargetTime = activityCollector._targetTime;
                //at this point, we are ready to upload, but to do that 
                //we need to...
                //1. determine if there are multiple segments we need to be uploading
                //  (todo, determine if this should be categorized as catching up)
                //2. calculate the new window time
                //3. slice off the window
                //4. update the current activities to ensure consistency 
                //5. update the window slice to be internally consistent
                
                //stash the old values for later
                var collectionWindowStr = activityCollector._formatNow(activityCollector._collectionWindowTime);
                var collectionWindowEndTime = activityCollector._collectionWindowTime;

                var then;
                if (activityCollector.activities.length && activityCollector.activities[0].time){
                    then = +new Date(activityCollector.activities[0].time +"Z");//ensures utc, convert to num
                }
                //special case alert!
                if (!then || then > collectionWindowEndTime){
                    //cant relay on then bc nothing has happened in a while. so we need 
                    //instead to send then to be the start of our collectionwindow above
                    then =  activityCollector._getWindowStartFromEnd(collectionWindowEndTime);
                }
                var numWindows = activityCollector._getNumberOfWindowsBetweenTimes(then, now);
                if (numWindows > 1){
                    //reset to the end of the first windows
                    collectionWindowEndTime = activityCollector._anchorToHour(then);
                    collectionWindowStr = activityCollector._formatNow(collectionWindowEndTime);
                    //bump window times up in a controlled fashion
                    activityCollector._collectionWindowTime = activityCollector._anchorToHour(collectionWindowEndTime);
                    activityCollector._targetTime = activityCollector._anchorToHour(collectionWindowEndTime) + 60000;                    
                } else {
                    //we are all caught up, so reset the target times 
                    activityCollector._targetTime = null;
                    activityCollector._collectionWindowTime = null;
                }
                var collectionWindowStartTime = activityCollector._getWindowStartFromEnd(collectionWindowEndTime);
                var collectionWindowStartTimeStr = activityCollector._formatNow(collectionWindowStartTime);
                var currentActivities = activityCollector.activities;
                var activitiesToSave = currentActivities.filter(function(a){
                    return a.time < collectionWindowStr;
                });
                var activitiesToKeep = currentActivities.filter(function(a){
                    return a.time >= collectionWindowStr;
                });
                //if we're starting off online, we need to bring the last stale
                //activity over as well
                var startingOffOnline = !activitiesToKeep.length || 
                    (activitiesToKeep[0].payload_uuid === "39c4f580-5f5b-417f-8b55-b432802aa1d9" &&
                        !(activitiesToKeep[0].time === collectionWindowStr &&
                            activitiesToKeep[0].stale === "stale")
                        //a prior attempt may have already added this 
                    );
                if (startingOffOnline && activitiesToSave.length){
                    //WARNING: DO NOT CHANGE THIS OBJECT AS IT IS A REFERENCE TO THE
                    //OBJECT WE NEED TO UPLOAD IN THE PRIOR CHUNK!!!
                    var lastActivityFromPriorChunk = activitiesToSave[activitiesToSave.length -1];
                    activitiesToKeep = [{
                        time: collectionWindowStr,//window boundary is non-inclusive, so this defines the timeframe
                        payload_uuid: "39c4f580-5f5b-417f-8b55-b432802aa1d9",
                        payload: lastActivityFromPriorChunk.payload,
                        stale: "stale"
                    }].concat(activitiesToKeep);
                }
                activityCollector.activities = activitiesToKeep;
                //the window slice has to begin at the start of the timeframe. 
                //if it doesnt with an activity, that tells us that it started offline
                //which is no big, lets just make that explicit here.
                if (!activitiesToSave.length || activitiesToSave[0].time !==collectionWindowStartTimeStr){
                    activitiesToSave = [{
                        time: collectionWindowStartTimeStr,//window boundary is non-inclusive, so this defines the timeframe
                        payload_uuid: "c4bec4c2-725b-40f9-b484-e45061e8463c",
                        payload:{
                            status: "offline"
                        }
                    }].concat(activitiesToSave);
                }
                //we're gonna have to ask for a different url if we are uploading a 
                //chunk in the past so we have to calculate our window before all this goes
                //down.
                activityCollector._getConfig(collectionWindowStartTimeStr+"Z").then(function (config){
                    if (config.reason && !config.upload_url){
                        if (config.start_time && config.end_time){
                            //special case where the 
                            var blackoutStart = config.end_time.substr(0, config.end_time.length-1);
                            var blackoutEnd = config.start_time.substr(0, config.start_time.length -1);
                            var activitiesToDump = activityCollector.activities.filter(function(a){
                                return a.time >= blackoutStart && a.time < blackoutEnd;
                            });
                            var activitiesToKeep = activityCollector.activities.filter(function(a){
                                return a.time < blackoutStart || a.time >= blackoutEnd;
                            });
                            activityCollector.activities = activitiesToKeep;
                            //many times we will hit this when we're catching up. 
                            //this loses a good amount of the offline hours
                            if (activitiesToKeep.length && activitiesToKeep[0].time !== blackoutEnd){
                                activityCollector.activities.splice(0,0,{//insert it into the middle 
                                    time: blackoutEnd,
                                    payload_uuid: "c4bec4c2-725b-40f9-b484-e45061e8463c",
                                    payload:{
                                        status: "offline"
                                    }
                                });
                                var blackoutEndTime = +new Date(blackoutEnd +"Z");//ensures utc, convert to num
                                activityCollector._collectionWindowTime = activityCollector._anchorToHour(blackoutEndTime);
                                activityCollector._targetTime = activityCollector._anchorToHour(blackoutEndTime) + 60000;
                            } else {
                                activityCollector._targetTime = null;
                            }
                        } else {
                            activityCollector._targetTime = null;
                        }
                        activitiesToSave = [];
                        return $.Deferred().resolve();//exit early without sending
                    }
                    if (config.reason && config.start_time){
                        //a start_time implies that we are out of the blackout hours
                        //at the start of our timeframe but at start_time, we start
                        //collecting. this means we now need to dump all the data before this
                        var strippedTime = config.start_time.substr(0, config.start_time.length -1);
                        var activitiesToDump = activitiesToSave.filter(function (a){
                            return a.time < strippedTime;
                        });
                        activitiesToSave = activitiesToSave.filter(function(a){
                            return a.time >= strippedTime;
                        });
                        if (activitiesToDump.length){
                            var staleActivity = activitiesToDump[activitiesToDump.length-1];
                            staleActivity.time = strippedTime;//we're dumping this so we can mutate it
                            if (staleActivity.payload_uuid ==="39c4f580-5f5b-417f-8b55-b432802aa1d9"){
                                staleActivity.stale = "stale";
                            } else if (staleActivity.payload_uuid === "c4bec4c2-725b-40f9-b484-e45061e8463c" && activitiesToSave.length &&
                                activitiesToSave[0].payload_uuid === "c4bec4c2-725b-40f9-b484-e45061e8463c" &&
                                activitiesToSave[0].time === strippedTime
                                ){
                                //a common transition if you start mid-hour, will be fully restricted hour to 
                                //start-restricted hour. in those cases, we dont need to double up the stale
                                //bc it's already been added
                                staleActivity = null;
                            }
                            if (staleActivity){
                                activitiesToSave = [
                                    staleActivity
                                ].concat(activitiesToSave);
                            }
                        }
                        collectionWindowStartTimeStr = strippedTime;
                    } else if (config.reason && config.end_time){
                        //an end_time implies that we begin the timeframe within the
                        //blackout hours, but we end the timeframe blacked out. this
                        //means we need to dump all the data after
                        var strippedTime = config.end_time.substr(0, config.end_time.length -1);
                        activitiesToSave = activitiesToSave.filter(function (a){
                            return a.time < strippedTime;
                        });
                        collectionWindowStr = strippedTime;
                    }
                    if (config.reason && config.ip_address){
                        activitiesToSave = [{
                            time: collectionWindowStartTimeStr,
                            payload_uuid: "c4bec4c2-725b-40f9-b484-e45061e8463c",
                            payload:{
                                status: "ip-restricted: " + config.ip_address
                            }
                        }];
                    }
                    var data = pako.gzip(JSON.stringify({
                        cabra_name:"dyknow.me/participant_activity_monitor",
                        created: collectionWindowStartTimeStr,
                        completed: collectionWindowStr,
                        os_type: "chromebook",
                        os_version: activityCollector.info.getOSVersion(),
                        client_version: activityCollector.info._getProductVersion(),
                        objects: activitiesToSave
                    }), {level:9});
                    return activityCollector.api.uploadToUrl(config.upload_url, data).then(function(ret){
                        activityCollector._uploadFails = 0;
                        activityCollector.backup();//make a new backup so we dont double post
                        return ret;
                    }, function (err){
                        //for the time being we will consider all failures the same
                        activityCollector._uploadFails ++;
                        if (activityCollector._uploadFails >= 2){
                            //sigh: lets give up on this window
                            Logger.error(err);
                            Logger.error("activityCollector - failure number " +
                                activityCollector._uploadFails +
                                " giving up on window " + 
                                collectionWindowStartTimeStr
                            );
                            //note: we're not resetting the fails here 
                            //because we want to limit exposure to more
                            //systemic deterministic errors at a school 
                            return $.Deferred().resolve();
                        }
                    });
                }).then(function (succcess){
                    //lets ensure we dont tight loop saving up
                    _.delay(function (){
                        activityCollector.runTimer();
                    }, 60000);
                }, function (err){

                    activityCollector._collectionWindowTime = oldWindowTime;
                    activityCollector._targetTime = oldTargetTime;
                    activityCollector.activities = activitiesToSave.concat(activityCollector.activities);
                    //hmm we need to try and restore these activities
                    //and then also we need to run again, but for now
                    //lets just dump the data and try again
                    _.delay(function (){
                        activityCollector.runTimer();
                    }, 60000);
                });
            } else {
                if (delaySwitchboardTracker.delaySwitchboard){
                    //what does this being active tell us about the current window?
                    //nothing about the current window. what does it tell us about
                    //past windows? well, nothing there either bc honestly 
                }
                _.delay(function (){
                    activityCollector.runTimer();
                }, 60000);
            }
        },
        _getConfig: function (date_time, deviceOffset){
            if(!deviceOffset){ deviceOffset = 0;}
            return activityCollector.api.getActivityConfig(date_time, deviceOffset).then(function (config){
                if (config.reason && !config.head_url){
                    //bail early, server doesnt want us to save
                    return $.Deferred().resolve(config);
                }
                return activityCollector.api.checkHeadOfUrl(config.head_url).then(function (){
                    //already exists! oh no!
                    var newDevice = deviceOffset + 1;
                    return activityCollector._getConfig(date_time, newDevice);
                }, function (err){
                    if (err && err.status === 404){
                        return $.Deferred().resolve(config);//I think that resolves?
                    }
                });
            });
        },
        backupIfNeeded: function (){
            var now = _.now();
            if (!activityCollector._lastBackup){ 
                activityCollector._lastBackup = now;
            }
            if (now >= activityCollector._lastBackup + (4*60000)){
               activityCollector.backup();
            }
        },
        backup: function() {
            //beginnings of our work to tighten up resilience to restarts.
            //this is gonna be critical for the move to manifest v3, but we'll 
            //be taking this in phases in order to avoid disruption for teachers
            //theyve been through enough
            var retDfd = $.Deferred();//currently always declaring the backup a success. used for declaring this as finished
            var now = _.now();
            chrome.storage.local.set({
                "activitycollector_cache": {
                    collectionWindowTime: activityCollector._collectionWindowTime,
                    lastTime: activityCollector._lastTime,
                    targetTime: activityCollector._targetTime,
                    activities: activityCollector.activities
                } 
            }, function () {
                if(chrome.runtime.lastError){
                    Logger.error("activityCollector - backup fail " + chrome.runtime.lastError.message);
                    chrome.storage.local.remove("activitycollector_cache", function () {
                        //not sure what we could do here to recover
                        retDfd.resolve();//successful either way
                    });//attempt to clear bc we're unreliable
                } else {
                    retDfd.resolve();
                }

            });
            activityCollector._lastBackup = now;
            return retDfd;
        }
    };
    return activityCollector;
});