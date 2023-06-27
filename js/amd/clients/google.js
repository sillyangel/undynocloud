define(['amd/clients/api', 'amd/settings', "underscore"], function(APIClient, SETTINGS, _){
    var GoogleClient = function () {

        var _this = this,
            clientAlreadyInit = false,
            MESSAGES = {
                "ACCESS_DENIED": "The user did not approve access.",
                "NOT_GRANTED" : "OAuth2 not granted or revoked.",
                "FAILED": "OAuth2 request failed: Not authorized."
            };

        //@returns Promise
        //  resolves: { email: "some@email.gov"}
        //  rejects: { message: "provided" } 
        //      if an exception is thrown calling chrome.identity.getProfileUserInfo 
        //      if chrome.runtime.lastError is set for chrome.identity.getProfileUserInfo
        //      if chrome.identity.getProfileUserInfo never calls back or calls back after 5 minutes
        //      if it cannot reach the data due to some other issue (claimed as user not signed in)
        this.getEmail = function () {
            return new Promise(function ( resolve, reject ) {
                var authStart = false;
            
                // @corecode_begin getAuthToken
                // @description Since Chrome 37.
                //  Retrieves email address and obfuscated gaia id of the user signed into a profile.
                //  This API is different from identity.getAccounts in two ways. The information returned is available offline, and it only 
                //  applies to the primary account for the profile.
                // @see http://developer.chrome.com/apps/app_identity.html
                // @see https://developer.chrome.com/apps/identity#method-getProfileUserInfo
                chrome.identity.getProfileUserInfo(function (userInfo){
                    authStart = true;
                    if (chrome.runtime.lastError) {
                        reject({ message : chrome.runtime.lastError });
                    } else if ( userInfo && typeof userInfo === 'object' && userInfo.email ) {
                        resolve({ email : userInfo.email });
                    } else {
                        reject({ message : "Can't reach the data. User not signed in (likely) or manifest permission not specified (unlikely)" });
                    }
                });

                // If user doesn't login to Chrome we haven't receive anything
                // So we must reject our promise object in custom way in 5 minutes
                _.delay(function(){
                    if ( !authStart) {
                        reject({ message : "Chrome browser doesn't link to any accounts" });
                    }
                }, 5 * 60 * 1000 );
            });
        };
        
    };
    extend(GoogleClient, APIClient);

    return GoogleClient;
});


