define([
    'amd/clients/api', 'amd/logger/logger','amd/lib/uuid', 
    'amd/settings','amd/clients/logsender','amd/utils/MyInfo',
    'underscore'
], function(
       ApiClient, Logger, uuid, 
       SETTINGS, LogSenderClient, MyInfo,
       _
   ){
    var LogWatcher = function() {
        var _this = this;
        this.LogSender = new LogSenderClient();
        this.timeout = false;
        this.sendingLogs = false;
        this.token = false;
        this.running = true;
        this.user = false;
        this.apiClient = new ApiClient();
        this.apiClient.baseUrl = SETTINGS.DYDEV.CORE_SERVER + 'v1/';
        this.resolver = false;
        this.waiter = false;

        this.start = function() {
            _this._timer();
        };
        
        this._timer = function() {
            _this.timeout = _.delay(function() {
                if(!MyInfo.getInstance().info ||! _this._isInSchoolDay()) {
                    _this._timer();
                } else {
                    _this.checkForLogRequests().then(function() {
                        _this._timer();
                    }, function () {
                        _this._timer();
                    });
                }
            }, 1800000);
        };

        this._isInSchoolDay = function () {
            var now = new Date(_.now());
            var nowHour = now.getHours();
            return nowHour >= 9 && nowHour <= 15;//only ask for request logs between 9 and 3pm
        };

        this._sendStatusUpdate = function(request_id, status) {
             return _this.apiClient.put(
                 'RequestLogs?request_id=' + request_id + "&status=" + status + "&access_token=" + MyInfo.getInstance().info.token,SETTINGS.DEFAULT_RETRY_OPTIONS);                 
        };
        
        this._sendLogs = function(request) {
            var endDate = new Date(),
                startDate = new Date(endDate.getTime());
            startDate.setDate(startDate.getDate()- 7);
            var offset = endDate.getTimezoneOffset() / 60;

            startDate.setHours(startDate.getHours() + offset);
            endDate.setHours(endDate.getHours() + offset);

            var myInfo = MyInfo.getInstance();
            var options = {
                "username": myInfo.info.me.username, 
                "institution": myInfo.info.me.customer_name ? myInfo.info.me.customer_name : "",
                "email": myInfo.info.me.handles && myInfo.info.me.handles[0] ? myInfo.info.me.handles[0].handle_value : "",
                "notes":request.notes? request.notes : ""
            };

            return _this.LogSender.sendLogsWithStartDate(startDate, endDate, options).then(function() {
                    return _this._sendStatusUpdate(request.request_id,"success");
                }, function(error) {
                    //do nothing
                    return; 
                });
        };

        this._sendHealthCheckLogs = function(request) {
            var endDate = new Date(),
                startDate = new Date(endDate.getTime());
            startDate.setDate(startDate.getDate()- 7);
            var offset = endDate.getTimezoneOffset() / 60;

            startDate.setHours(startDate.getHours() + offset);
            endDate.setHours(endDate.getHours() + offset);

            var myInfo = MyInfo.getInstance();
            var options = {
                "username": "Logs sent via Chromebook Health Check", 
                "institution": myInfo.info.me.customer_name ? myInfo.info.me.customer_name : "",
                "email": myInfo.info.me.handles && myInfo.info.me.handles[0] ? myInfo.info.me.handles[0].handle_value : "",
                "notes":"Heath Check Code: " + request.health_check_code
            };

            return _this.LogSender.sendLogsWithStartDate(startDate, endDate, options);
        };

        //prerequisites: myinfo.getinstance().info.me.account_id and myinfo.getinstance().info.token exist anre populated
        //postconditions: returns a thenable 
        this.checkForLogRequests = function(){            
            return _this.apiClient.get('RequestLogs?id=' + MyInfo.getInstance().info.me.account_id + "&access_token=" + MyInfo.getInstance().info.token,SETTINGS.DEFAULT_RETRY_OPTIONS, false).then(function(result){
                if(result && result.request_id){
                    Logger.log("logWatcher", "starting send logs");
                    return _this._sendLogs(result);
                }
            },function(err){
                return;
            });            
        };
    };
    return LogWatcher;
});