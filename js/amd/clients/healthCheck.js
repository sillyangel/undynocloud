define(['amd/clients/api', 'amd/settings', 'amd/logger/logger'], 
function(APIClient, SETTINGS, Logger) {
    var HealthCheckClient = function () {
        this.baseUrl = SETTINGS.DYDEV.CORE_SERVER + 'v1/';
        this.getHealthCheckByCode = function (req) {
            if (!req) {
                throw "getHealthCheckByCode called without a request";
            }
            if (!req.code) {
                throw "getHealthCheckByCode requires a code";
            }
            return this.get("healthcheck/code?code=" + req.code, SETTINGS.DEFAULT_RETRY_OPTIONS);
        };

        this.deviceResolution = function (req) {
            if (!req) {
                throw "deviceResolution called without a request";
            }
            if (!req.code) {
                throw "deviceResolution requires a code";
            }

            if (!req.account_ids) {
                throw "deviceResolution requires account ids";
            }

            return this.post("healthcheck/deviceresolution",
            {
                "data": JSON.stringify(req),
                "headers": SETTINGS.DYDEV.OAUTH.HEADER
            }, SETTINGS.DEFAULT_RETRY_OPTIONS);
        };
    };

    extend(HealthCheckClient, APIClient);

    return HealthCheckClient;
});