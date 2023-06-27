define([
    'amd/clients/api', 'amd/logger/DeviceInformation', 'amd/logger/EnvironmentInformation', 
    'amd/settings', 'amd/logger/logger', 'amd/utils/healthCheckInfo'
], function(
    APIClient, DeviceInformation, EnvironmentInformation, 
    SETTINGS, Logger, HealthCheckInfo
    ){
    var OAuthClient = function () {
        var deviceInfo = new DeviceInformation(),
            envInfo = new EnvironmentInformation();

        this.baseUrl = SETTINGS.DYDEV.OAUTH.SERVER;

        this._fragment = "oauth/authenticate";

        this._requestObj = SETTINGS.DYDEV.OAUTH.REQUEST;

        this._credentials = {
            'username' : "",
            'password' : ""
        };

        this.authenticate = function ( username, password, vanity, deviceToken,  hostname, macAddress ) {

            if ( !username ) {
                throw new SystemError( "Username must be not empty !" );
            }

            this._credentials.username = username;
            this._credentials.password = password;
            this._credentials.vanity = vanity;

            var obj = {
                'username' : username,
                'password' : password === undefined ? '' : password,
                'vanity' : vanity === undefined ? '' : vanity,
                'hostname' : hostname === undefined ? '' : hostname,
                'mac_addresses' : macAddress === undefined ? '' : macAddress,
                'device_token' : deviceToken === undefined ? '' : deviceToken,
                'os_type': deviceInfo._getOSType(),
                'os_description': deviceInfo._getOSDescription(),
                'domain': '',
                'client_version': envInfo._getProductVersion()
            };

            return this.post( this._fragment,
                {
                    "data": JSON.stringify(Object.extend(this._requestObj, obj)),
                    "headers": SETTINGS.DYDEV.OAUTH.HEADER
                }, SETTINGS.DEFAULT_RETRY_OPTIONS);
        };

        this.getLastCredentials = function () {
            return this._credentials;
        };

        this.log = function(call, params){
            var parameters = params.parameters;
            if(parameters && typeof parameters === "object" && parameters.data) {
                var data = JSON.parse(parameters.data);
                data.password = '****';
                parameters.data = JSON.stringify(data);
            }
            params.parameters  = parameters;
            Logger.debug(call, params);
        };
    };

    extend(OAuthClient, APIClient);

    return OAuthClient;
});
