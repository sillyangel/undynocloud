define([
    'amd/broadcast/sessionManager', 'amd/settings', 'amd/clients/google',
    'amd/clients/core', 'amd/clients/oauth', 'amd/logger/logger',
    'amd/utils/featureFlags', 'amd/sandbox',
    'amd/clients/api','amd/utils/MyInfo', 'underscore',
    'amd/utils/healthCheckInfo', 'amd/utils/activityCollector'
], function(
    BroadcastSessionManager, SETTINGS, GoogleClient,
    CoreApiClient, OAuthClient, Logger,
    FeatureFlags, Sandbox,
    ApiClient, MyInfo, _,
    HealthCheckInfo, activityCollector
) {
    var IDN = function(){
        var sandbox = new Sandbox().init();
        var _this = this;
        this.MyInfo = MyInfo;
        this.HealthCheckInfo = HealthCheckInfo;
        this.pendingAuthAgreement = null;
        this.pendingAuthAgreementDelay = 15000;
        this.authAgreementAccepted = false;
        this.allowAuthie = false;
        this.pendingLoginError = "";
        this.bsm = new BroadcastSessionManager();
        this.gClient = new GoogleClient();
        this.oauthClient = new OAuthClient();
        this.apiClient = new ApiClient();
        this.apiClient.baseUrl = SETTINGS.DYDEV.CORE_SERVER + 'v1/';

        this.online = function() {
            return window.navigator.onLine;
        };

        this.handleNoInternetConnection = function(){
            //no internet connection;
            Logger.warn("no internet connection, retrying oauth in 15 seconds");
            setTimeout(function(){
                _this.startAuthProcess();
            }, 15000);
        };

        /**
         * Retry to start the authentication process after a delay.
         * @param {number} [delay=90] A delay to wait in seconds.
         */
        this.retryAuthProcess = function(delay) {
            if (typeof delay !== 'number' || delay <= 0) { delay = 90; }

            Logger.debug('IDN: will restart auth in ' + delay + ' seconds');
            _.delay(function() {
                _this.startAuthProcess();
            }, delay * 1000);
        };

        this.initListeners = function () {
            sandbox.subscribe(SETTINGS.EVENTS.LOG_IN_FORM_READY, function(){
                if(_this.pendingLoginError){
                    sandbox.publish(SETTINGS.EVENTS.LOG_IN_ERROR, {error: _this.pendingLoginError});
                    _this.pendingLoginError = "";
                }
            });

            sandbox.subscribe(SETTINGS.EVENTS.GOOGLE_LOGIN, function(){
                _this.startAuthProcess();
            });

            sandbox.subscribe(SETTINGS.EVENTS.SIGN_OUT, function () {
                if (dyknowExtension.authType === SETTINGS.AUTH_TYPE.GOOGLE) {
                    sandbox.subscribe(SETTINGS.EVENTS.CORE_CLIENT_STOPS, _this.coreClientStopsObserver);
                    _this.bsm.stop();
                }
            });

            sandbox.subscribe(SETTINGS.EVENTS.SIGN_IN, function () {
                chrome.tabs.query({"url": chrome.extension.getURL("form.html") }, _this.closeTabs);
                sandbox.subscribe(SETTINGS.EVENTS.CORE_CLIENT_STOPS, _this.coreClientStopsObserver);
                _this.bsm.stop();
            });

            // Show authentication notice
            sandbox.subscribe(SETTINGS.EVENTS.CALL_AUTH_NOTICE_FORM, function() {
                Logger.info('IDN: Authentication notice requested');
                _this.showAuthAgreement();
            });

            sandbox.subscribe(SETTINGS.EVENTS.AUTH_NOTICE_ACCEPTED, function() {
                Logger.info('IDN: Authentication notice accepted');
                _this.authAgreementAccepted = true;
                _this.getAuthTabs().then(_this.closeTabs);
                _this.endPendingAuthAgreement();
                _this.authenticate(true);
            });

            // Show login form (authie)
            sandbox.subscribe(SETTINGS.EVENTS.CALL_LOGIN_FORM, function (error) {
                dyknowExtension.authType = SETTINGS.AUTH_TYPE.FORM;
                chrome.windows.create({
                    "url": chrome.extension.getURL("form.html"),
                    "type": "popup",
                    "height": 580,
                    "width": 800
                }, function (window) {
                    if(error){
                        sandbox.publish(SETTINGS.EVENTS.LOG_IN_ERROR, error);
                    }
                });
            });

            sandbox.subscribe(SETTINGS.EVENTS.FORM_LOGIN, function(data, sender, responseCallback){
                Logger.debug("IDN: Starting Dyknow Auth");
                Logger.info("IDN: Provided Username:", data.username);
                HealthCheckInfo.IDN_Username = data.email;
                Logger.info("IDN: Provided Vanity:", data.vanity);
                HealthCheckInfo.IDN_InFlight = true;
                _this.callAuthClient(data.username, data.password, data.vanity).then(function (oauthResponse) {
                    if (typeof(oauthResponse) == "string") {
                        HealthCheckInfo.OAuth_Error = true;
                    }
                    Logger.info("IDN: Authenticated based on User Provided Credentials");
                    var token = oauthResponse.access_token;
                    //TODO: DRY this out with the google auth/cached flow
                    _this.getMe(token).then(function (user) {
                        if (!!user) {
                            FeatureFlags.setSchool(user.customer_name);
                            activityCollector.setUser(user);
                            Logger.info("IDN: Starting up Switchboard");
                            _this.bsm.init(token);
                            sandbox.publish(SETTINGS.EVENTS.LOG_IN_SUCCESS, {me:user, token:token});
                            MyInfo.getInstance({me:user, token:token});
                            HealthCheckInfo.IDN_Passed = true;
                            HealthCheckInfo.IDN_InFlight = false;
                            HealthCheckInfo.IDN_Username = data.email;
                            HealthCheckInfo.IDN_AccountID = data.account_id;
                            HealthCheckInfo.OAuth_Error = false;
                        } else {
                            Logger.warn("IDN: Anonymous Authentication");
                            _this.tryShowAuthie();
                        }
                    }, function (err) {
                        Logger.error("IDN: Get User Failed", err);
                        sandbox.publish(SETTINGS.EVENTS.LOG_IN_ERROR, err);
                    });
                }, function(error) {
                    Logger.warn("IDN: Failed to Authenticate with User Provided Credentials", error);
                    sandbox.publish(SETTINGS.EVENTS.LOG_IN_ERROR, error);
                });
            });

            //NOTE: we have forked this code path because of a lack of trust in the current sandbox process
            //we need to investigate why there are problems in that implementation but once we have confidence
            //in sandbox again we can unify the implementations but we will need to change in sessionManager.js too
            $.on(SETTINGS.EVENTS.IDENTITY_INVALID, function () {
                $.on(SETTINGS.EVENTS.CORE_CLIENT_STOPS, _this.rebootCompletedObserver);
                _this.bsm.stop();
            });
        };

        this.checkLocalStorageOnAuthData = function () {
            return new Promise(function (resolve, reject) {
                try {
                    chrome.storage.local.get(SETTINGS.STORAGE.OAUTH, function (oauthInfo) {
                        if(oauthInfo && oauthInfo[SETTINGS.STORAGE.OAUTH]){
                            if (!!oauthInfo[SETTINGS.STORAGE.OAUTH].authToken) {
                                resolve(oauthInfo[SETTINGS.STORAGE.OAUTH].authToken);
                            } else {
                                reject();
                            }

                            resolve(oauthInfo[SETTINGS.STORAGE.OAUTH].authToken ? oauthInfo[SETTINGS.STORAGE.OAUTH].authToken : "");
                        } else {
                            reject();
                        }
                    });
                } catch (e) {
                    Logger.error(e.message, e.stack);
                    reject();
                }
            });
        };

        /**
         * Check if the core client is currently communicating.
         */
        this.isCommunicating = function() {
            return this.bsm.isCommunicating();
        };

        this.getMe = function(token){
            var api = new CoreApiClient();
            api.accessToken = token;
            return api.getMe();
        };

        this.callAuthClient = function (username, password, vanity, deviceToken) {
            return new Promise(function(resolve, reject){
                _this.oauthClient.authenticate(username, password, vanity, deviceToken).done(function (data) {
                    _this.saveAuthDataToLocalStorage({accessToken: data.access_token});
                    resolve(data);
                })
                .done(function(data) {
                    HealthCheckInfo.OAuth_Error = false;
                })
                .fail(function (error) {
                    if (error.error_description != "customer_token is invalid") {
                        HealthCheckInfo.OAuth_Error = true;
                    }
                    _this.saveAuthDataToLocalStorage({accessToken: ""});
                    reject(error);
                });
            });
        };

        this.saveAuthDataToLocalStorage = function (data) {
            if (data && typeof data === "object") {
                var oauthInfo = {};
                oauthInfo[SETTINGS.STORAGE.OAUTH] =
                {
                    "authToken" :  data.accessToken
                };

                chrome.storage.local.set(oauthInfo);
            }
        };

        this.showAuthAgreement = function() {
            Logger.info('IDN: Display authentication notice');

            return _this.getAuthTabs()
            .then(_this.closeTabs)
            .catch(function() {})
            .then(_this._showAuthAgreement);
        };

        this._showAuthAgreement = function() {
            // Guard against showing the agreement when accepted.
            if (_this.authAgreementAccepted) { return; }

            // Guard against being offline.
            if (!_this.online()) {
                Logger.info('IDN: Offline, delaying authentication notice');
                _this.retryAuthProcess();
                return;
            }

            Logger.info('IDN: Displaying authentication notice');

            var w = 800;
            var h = 580;
            chrome.windows.create(
                {
                    url: chrome.extension.getURL('authNotice.html'),
                    type: 'popup',
                    focused: true,
                    width: w,
                    height: h,
                    left: (screen.width/2) - (w/2),
                    top: (screen.height/2) - (h/2)
                },
                function(popup) {
                    Logger.info('IDN: Authentication notice shown');
                    _this.startPendingAuthAgreement();
                }
            );
        };

        this.startPendingAuthAgreement = function() {
            // Guard against agreement already accepted.
            if (_this.authAgreementAccepted) {
                _this.endPendingAuthAgreement();
                return;
            }
            // Guard against the agreement already pending.
            if (_this.pendingAuthAgreement) { return; }

            Logger.info('IDN: Setting timeout to check authentication notice');
            _this.pendingAuthAgreement = window.setTimeout(
                _this.checkAuthAgreement.bind(_this),
                _this.pendingAuthAgreementDelay
            );
        };

        this.endPendingAuthAgreement = function() {
            // Guard against no pending agreement.
            if (!_this.pendingAuthAgreement) { return; }

            window.clearTimeout(_this.pendingAuthAgreement);
            _this.pendingAuthAgreement = null;
        };

        this.checkAuthAgreement = function() {
            _this.endPendingAuthAgreement();
            Logger.info('IDN: Checking authentication notice visibility');

            // Guard against accepted authentication agreements.
            if (_this.authAgreementAccepted) { return; }

            return _this.getAuthTabs().then(
                // There should only be one, but check the visibility of
                // all authentication confirmation windows.
                function(tabs) {
                    return Promise.all(tabs.map(function(tab, i) {
                        return new Promise(function(resolve, reject) {
                            // Depending on the error, `chrome.windows.get` may
                            // synchronously throw an exception or
                            // asynchronously set `chrome.runtime.lastError`
                            // for the callback to "catch".
                            try {
                                chrome.windows.get(tab.windowId, function(w) {
                                    if (chrome.runtime.lastError) {
                                        // Reject asynchronous errors.
                                        reject();
                                    } else if (w.focused) {
                                        resolve();
                                    } else {
                                        reject();
                                    }
                                });
                            } catch(e) {
                                // Reject synchronous errors.
                                reject();
                            }
                        });
                    })).then(
                        // Reset the timeout if the one window has focus.
                        _this.startPendingAuthAgreement,
                        // Show the agreement if any window didn't have focus.
                        _this.showAuthAgreement
                    );
                },
                // If no tabs are fetched, show the agreement.
                _this.showAuthAgreement
            );
        };

        this.getAuthTabs = function() {
            return new Promise(function(resolve, reject) {
                chrome.tabs.query(
                    {
                        url: chrome.extension.getURL('authNotice.html')
                    },
                    function(tabs) {
                        if (tabs.length) {
                            if (tabs.length > 1) {
                                Logger.debug('IDN: ' + tabs.length +
                                    ' authentication notice tabs open!');
                            }
                            resolve(tabs);
                        } else {
                            reject();
                        }
                    }
                );
            });
        };

        this.closeTabs = function(tabs) {
            return Promise.all(tabs.map(function(tab) {
                return new Promise(function(resolve, reject) {
                    if (!tab || !tab.id) { return reject(); }
                    // Depending on the error, `chrome.tabs.get` may
                    // synchronously throw an exception or asynchronously set
                    // `chrome.runtime.lastError` for the callback to "catch".
                    try {
                        chrome.tabs.remove(tab.id, function() {
                            if (chrome.runtime.lastError) {
                                // Reject asynchronous errors.
                                reject();
                            } else {
                                resolve();
                            }
                        });
                    } catch(e) {
                        // Reject synchronous errors.
                        reject();
                    }
                });
            }));
        };

        this.tryShowAuthie = function (error) {
            if (_this.allowAuthie) {
                Logger.debug("IDN: Authie is allowed, showing form");
                if (error) {
                    _this.pendingLoginError = (error.error_description) ? error.error_description : error.error;
                }
                sandbox.publish(SETTINGS.EVENTS.CALL_LOGIN_FORM, { });
                return true;
            } else {
                Logger.warn("IDN: Authie is needed but not allowed");
                return false;
            }
        };

        this.authenticate = function(deviceToken) {
            // Guard against being offline.
            if (!_this.online()) {
                Logger.info('IDN: Offline, delaying authentication');
                _this.retryAuthProcess();
                return;
            }

            var standardAuth = function() {
                _this._authenticate(deviceToken);
            };

            Logger.debug("IDN: Starting Google Auth Without Interaction");
            _this.gClient.getEmail().then(
                function(result) {
                    var email = result.email;
                    Logger.info("IDN: Provided Username:", email);
                    HealthCheckInfo.IDN_Username = email;
                    _this._authenticateWithEmail(email, deviceToken, result);
                },
                function(err) {
                    Logger.error("IDN: Failed to get User Email", err);
                    standardAuth();
                }
            );
        };

        this._authenticate = function(deviceToken) {
            dyknowExtension.authType =  SETTINGS.AUTH_TYPE.GOOGLE;
            Logger.debug("IDN: Starting Google Auth");
            _this.gClient.getEmail().then(
                function(result) {
                    var email = result.email;
                    Logger.info("IDN: Provided Username:", email);
                    _this._authenticateWithEmail(email, deviceToken, result);
                },
                function(err) {
                    Logger.warn("IDN: Failed to get User Email", err);
                    if(!_this.tryShowAuthie()){
                        _this.retryAuthProcess(30);
                    }
                }
            );
        };

        this._authenticateWithEmail = function(email, deviceToken, result) {
            if (!!deviceToken) {
                Logger.info("IDN: Will Authenticate reusing AccessToken :", deviceToken);
            }
            this.logDeviceid();

            _this.callAuthClient(email, undefined, undefined, deviceToken).then(
                function(oauthResponse) {
                    if (typeof(oauthResponse) == "string") {
                        HealthCheckInfo.Login_Portal = true;
                    }
                    else {
                        HealthCheckInfo.Login_Portal = false;
                    }
                    if (!oauthResponse || !oauthResponse.access_token) {
                        Logger.info("IDN: did not get an access token. will retry");
                        _this.retryAuthProcess();
                        return;
                    }
                    Logger.info("IDN: Authenticated based on User Email");
                    var token = oauthResponse.access_token;
                    _this.getMe(token).then(
                        function(user) {
                            if (user && user.customer_name) {
                                FeatureFlags.setSchool(user.customer_name);
                                HealthCheckInfo.IDN_Passed = true;
                                HealthCheckInfo.IDN_InFlight = false;
                                HealthCheckInfo.IDN_Username = email;
                                HealthCheckInfo.IDN_AccountID = user.account_id;
                                HealthCheckInfo.OAuth_Error = false;
                                activityCollector.setToken(token);
                                activityCollector.setUser(user);
                                Logger.info("IDN: Starting up Switchboard");
                                _this.bsm.init(token);
                                sandbox.publish(SETTINGS.EVENTS.LOG_IN_SUCCESS, {me:user, token:token});
	                            MyInfo.getInstance({me:user, token:token});
                            } else {
                                Logger.warn("IDN: did not confirm access token. will retry");
                                _this.retryAuthProcess();
                            }
                        },
                        function(err) {
                            Logger.error("IDN: Get User Failed");
                            if (err && err.status === 0) {
                                _this.handleNoInternetConnection();
                            } else {
                                _this.retryAuthProcess();
                            }
                        }
                    );
                },
                function(err) {
                    Logger.warn("IDN: Failed to Authenticate with User Email", err);
                    if (result && result.status === 0) {
                        _this.handleNoInternetConnection();
                    } else if (!!deviceToken) {
                        Logger.info("IDN: Clearing Cached Auth Token");
                        //Clear this just in case its invalid
                        _this.saveAuthDataToLocalStorage({accessToken: ""});
                        Logger.debug("IDN: will restart auth");
                        //restart this immediately just in case the auth token is just bad
                        _this.startAuthProcess();
                    } else {
                        if (!_this.tryShowAuthie({
                            error: email + ' is not associated with a Dyknow Cloud account, please contact an administrator',
                            error_description: email + ' is not associated with a Dyknow Cloud account, please contact an administrator'
                        })) {
                           _this.retryAuthProcess();
                        }
                    }
                }
            );
        };

        this.logDeviceid = function () {
            //ideally every device is the same and matches up, but that's not the reality in a 
            //small number of machines. log out the deviceid so we can help admins track down
            //which machine was being used when the problem happened, particularly when students
            //are pulling devices off a cart. important to note, this doesnt work if the admin 
            //didnt push the extension out, but we can at least help the ones who did
            if (chrome.enterprise && chrome.enterprise.deviceAttributes && chrome.enterprise.deviceAttributes.getDirectoryDeviceId){
                chrome.enterprise.deviceAttributes.getDirectoryDeviceId(function (deviceId){
                    Logger.info("managed deviceId: " + deviceId);
                });
            }
        };

        this.startAuthProcess = function () {
            var promise = _this.checkLocalStorageOnAuthData();
            promise.then(function(token) {
                Logger.info("Has a cached access token, checking user info for token:", token);
                _this.authenticate(token);
            }, function() {
                Logger.info("IDN: No cached access token yet, starting auth flow");
                _this.authenticate();
            });
        };

        this.coreClientStopsObserver = function () {
            sandbox.unsubscribe(SETTINGS.EVENTS.CORE_CLIENT_STOPS, _this.coreClientStopsObserver);
            _this.startAuthProcess();
        };

        //NOTE: we have forked this code path because of a lack of trust in the current sandbox process
        //we need to investigate why there are problems in that implementation but once we have confidence
        //in sandbox again we can unify the implementations but we will need to change in sessionManager.js too
        this.rebootCompletedObserver = function () {
            $.off(SETTINGS.EVENTS.CORE_CLIENT_STOPS, _this.rebootCompletedObserver);
            _this.startAuthProcess();
        };

        this.start = function(){
            this.initListeners();
            this.startAuthProcess();
        };
    };
    return IDN;
});