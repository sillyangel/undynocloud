define([], function(){
    var EnvironmentInformation = function (){
        this.appVersion = navigator.appVersion;

        this.getEnvironmentInformation = function(){
            return '';
        };

        this._getMonitorIsInstalled = function(){
            return '';
        };

        this._getMonitorIsRunning = function(){
            return '';
        };

        this._getMonitorAgentExists = function(){
            return '';
        };

        this._getProductVersion = function(){
            return window.chrome.runtime.getManifest().version;
        };

        this.getOSVersion = function () {
            var fragments = /Chrome\/(\d+\.\d+\.\d+\.\d+) /.exec(this.appVersion);
            if (fragments){
                var appOS = fragments[1];
                if (this.appVersion.indexOf("x86_64") !== -1){
                    appOS += " x64";
                } else if (this.appVersion.indexOf("x86_32") !== -1){
                    appOS += " x86";
                } else if (this.appVersion.indexOf(" arm") !== -1){
                    appOS += " arm";
                }
                    
                return "Chrome OS " + appOS;
            }

            return this.appVersion;
        };
    };

    return EnvironmentInformation;
});
