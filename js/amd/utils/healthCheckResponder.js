define([
    "amd/sandbox", 'amd/clients/healthCheck', 'amd/logger/logger',
    'amd/utils/healthCheckInfo', 'amd/utils/logWatcher', 'amd/utils/extensionRestarter'
], 
function (
    Sandbox, HealthCheckClient, Logger, 
    HealthCheckInfo, LogWatcher, restarter
) { 
    var sandbox = new Sandbox().init();
    var client = new HealthCheckClient();
    var logWatcher = new LogWatcher();
    function onCode(req) {
        client.getHealthCheckByCode(req)
            .then(function(response) {
                if (response)
                {
                    response.IDN = HealthCheckInfo;
                    sandbox.publish("codeenteredsuccess", response);
                }
                else {
                    sandbox.publish("codeenteredfailure", "Okay");
                }
            }, function(err) {
                if (err.error_description == "Connection was cancelled") {
                    sandbox.publish("codeenterednointernet", "Okay");
                }
                else {
                    sandbox.publish("codeenterederror", "Okay");
                }
            });
    }
    function onNotify(req) {
        if (req.issue == 811) { // Resolution 811 = IP Restrictions (8) + Not In Dyknow (11)
            var tempReq = req; // create a tempReq because we don't want to clear the corrected_email from the original request which we will use below
            var corrected_email = req.corrected_email;
            tempReq.issue = 8;
            tempReq.corrected_email = null;
            client.deviceResolution(tempReq) // send IP restrictions notifcation (8)
            .then(function(response) {
                if (response){
                    req.corrected_email = corrected_email;
                    req.issue = 11;
                    req.student_wan_address = null;
                    client.deviceResolution(req) // then send Not In Dyknow notification (11)
                    .then(function(response) {
                        if (response) {
                            sandbox.publish("codenotifysuccess"); // If both went: success
                        }
                        else {
                            sandbox.publish("codenotifyfailure"); // If we fail to post Not In Dyknow: failure
                        }
                    });
                }
                else {
                    sandbox.publish("codenotifyfailure"); // If we fail to post IP Restrictions: failure
                }
            });
        }
        else {
            client.deviceResolution(req)
            .then(function(response) {
                if (response)
                {
                    sandbox.publish("codenotifysuccess");
                }
                else {
                    sandbox.publish("codenotifyfailure");
                }
            }, function(err) {
                sandbox.publish("codenotifyfailure");
            });
        }
    }
    function onSendLogsAndRestart(req) {
        logWatcher._sendHealthCheckLogs(req).then(function(){
            restarter.restart(); //on success, restart
        }, function(){
            restarter.restart(); //on error, restart
        });
    }
    return {
        init: function () {
            sandbox.subscribe("codeEntered", onCode);
            sandbox.subscribe("codeNotify", onNotify);
            sandbox.subscribe("sendLogsAndRestart", onSendLogsAndRestart);
        }
    };
});