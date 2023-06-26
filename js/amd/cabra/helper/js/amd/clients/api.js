define([
    'amd/logger/logger', 'amd/settings','js/globals',
    'underscore'
], function(
       Logger, SETTINGS, __globals,
       _
){
    var APIClient = function () {

        var _this = this;
        /**
         *
         * @param Fragment
         * @returns {*}
         */
        this.log = function(call, params){
            Logger.debug(call, params);
        };

        this._processFragment = function (Fragment) {

            if (Fragment.indexOf('http') !== -1) {
                return Fragment;
            }

            return this.baseUrl + Fragment;
        };

        //weird, i know, but drastically simplifies
        //the recursive promises
        function sleep(timeout){
            var dfd = $.Deferred();
            _.delay(function () {
                dfd.resolve();
            }, timeout);
            return dfd;
        }

        function fetchWithRetry(url, fetchOptions, timeout, retryOptions, remainingTries){
            if (!remainingTries && remainingTries !== 0){
                //passing in without should throw with a stacktrace instead of throw with an infinite loop
                throw new Error("retryOptions.times cannot be empty");
            }
            if (remainingTries <= 0){
                return $.Deferred().reject(new Error("remainingTried should never reach 0 before call"));
            }

            var controller = new AbortController();
            var timerAbort = _.delay(function () {
                controller.abort();
            }, timeout);
            fetchOptions.signal = controller.signal;
            return fetch(url, fetchOptions).then(function (resp){
                clearTimeout(timerAbort);
                if (retryOptions.statusCodes.some(function (code){
                    return code === resp.status;
                })) {
                    remainingTries--;
                    if (remainingTries > 0){
                        return sleep(5000).then(function () {
                            return fetchWithRetry(url, fetchOptions, timeout, retryOptions, remainingTries);
                        });
                    }
                    //otherwise fall through to resolve the error
                }
                return $.Deferred().resolve(resp);
            }, function (err){
                //timeout or other errors get retried
                remainingTries--;
                if (remainingTries > 0){
                    return sleep(5000).then(function () {
                        return fetchWithRetry(url, fetchOptions, timeout, retryOptions, remainingTries);
                    });
                } else {
                    return $.Deferred().reject(err);
                }
            });

        }

        this._sendRequest = function ( type, url, addParams, retryOptions, callFatalOnErr) {
            var settings = {
                    "type": type,
                    "url": url,
                    timeout: 60000,
                },
                dfd = $.Deferred();
            var fetchOptions = {
                method: type,
                cors: "no-cors",
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json'
                }
            };
            
            if (addParams && addParams.times && (!retryOptions || retryOptions === true)){
                if (retryOptions === true){
                    callFatalOnErr = true;
                }
                //times is not a known param for addParams, so 
                //it must be retryactions
                retryOptions = addParams;
                addParams = false;
                
            }
          
            /**
             * Add data or/and another
             * params to request
             */
            if (addParams && typeof addParams === "object") {
                $.each(addParams,function(key, val){
                    settings[key] = val;
                });
            }
            if (addParams){
                //check this out
                if (addParams.headers){
                    fetchOptions.headers = addParams.headers;
                }
                if (addParams.data){
                    fetchOptions.body = addParams.data;
                }
            }

            Logger.debug("Attempting Request: " + type + ", " + url);
            var response;

            if(retryOptions && retryOptions.times){//to be valid, you need at least times
                response = fetchWithRetry(url, fetchOptions, settings.timeout, retryOptions, retryOptions.times);
            } else {
                //note, expected to update timeout via addParams
                var controller = new AbortController();
                fetchOptions.signal = controller.signal;
                _.delay(function () {
                    controller.abort();
                }, settings.timeout);

                response = fetch(url, fetchOptions);
            }

            response.then(function(resp){
                if(!resp.ok){
                    //redirected: false
                    //status: 404
                    //statusText: "Not Found")
                    var err = new Error();
                    err.json = {
                        status: resp.status,
                        statusText: resp.statusText
                    };
                    return resp.text().then(function (text){
                        try{
                            var json = JSON.parse(text);
                            var oldjson = err.json;
                            err.json = json;
                            err.json.status = oldjson.status;
                            err.json.statusText = oldjson.statusText;
                        } catch(ignored){
                            err.json.error_description = text;
                        }
                        return $.Deferred().reject(err);
                    });
                }
                return resp.text();
            }).then(function (text){
                try{
                    if (text === ""){ return "";}
                    var obj = JSON.parse(text);
                    Logger.info("Request Successful: " + type + ", " + url + " JSON:", text);
                    return obj;                    
                }catch(err){
                    Logger.error(err);
                    return $.Deferred().reject({
                        json: {
                            error_description: text
                        }
                    });
                }
            }).then(function (resp){
                dfd.resolve(resp);
            }, function(err){
               var json;
                if (err.name === "AbortError"){
                    json = { error_description: "Connection was cancelled" };
                } else if (!err.json) {
                    json = { error_description: err.name + ": " + err.message };                   
                } else if (err.json.status !== 200) {
                    json = err.json;
                } else {
                    json = { error_description: "Connection was cancelled" };
                }
                if (json.error_code === 4410) {
                    Logger.info("Request already added semi-Successful: " + type + ", " + url + " JSON:", json);
                    json.status = 200;
                    json.statusText = "";
                    dfd.resolve(json);
                } else {
                    var error = new Error();
                    error.name = 'Api Error';
                    error.message = json.error_description;
                    if(callFatalOnErr){
                        $.trigger(SETTINGS.EVENTS.FATAL_ERROR, error);
                    }
                    Logger.error("Request Failure: " + type + ", " + url + " failed " + JSON.stringify(json));
                    dfd.reject(json);
                }
            });
            return dfd;
        };

        this._TYPES = {
            GET: "GET",
            POST: "POST",
            PUT: "PUT",
            DELETE: "DELETE",
            HEAD: "HEAD"
        };

        this.baseUrl = '';

        this.get = function (Fragment, addParams, retryOptions, callFatalOnErr) {
            var url = this._processFragment(Fragment),
                promise = this._sendRequest(this._TYPES.GET, url, addParams, retryOptions, callFatalOnErr);

            return promise;
        };

        this.post = function (Fragment, addParams, retryOptions, callFatalOnErr) {
            var url = this._processFragment(Fragment),
                promise = this._sendRequest(this._TYPES.POST, url, addParams, retryOptions, callFatalOnErr);

            return promise;
        };

        this.put = function (Fragment, addParams, retryOptions, callFatalOnErr) {
            var url = this._processFragment(Fragment),
                promise = this._sendRequest(this._TYPES.PUT, url, addParams, retryOptions, callFatalOnErr);

            return promise;
        };

        this.head = function (Fragment, addParams, retryOptions, callFatalOnErr){
            var url = this._processFragment(Fragment),
                promise = this._sendRequest(this._TYPES.HEAD, url, false, retryOptions, callFatalOnErr);
                return promise;
        };

        this.delete = function (Fragment, retryOptions, callFatalOnErr) {
            var url = this._processFragment(Fragment),
                promise = this._sendRequest(this._TYPES.DELETE, url, false, retryOptions, callFatalOnErr);

            return promise;
        };


        this._shouldTearDown = function(url){
            //only tear down if the request was made to our server.
            var teardown = false;
            SETTINGS.HOSTNAMES.forEach(function(u){
                if(url.indexOf(u) !== -1){
                    teardown = true;
                }
            });
            return teardown;
        };
    };

    return APIClient;
});